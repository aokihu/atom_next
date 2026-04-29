import type {
  IntentRequestHandleResult,
  IntentRequest,
  IntentRequestSafetyContext,
  MemoryScope,
  PrepareConversationIntentRequest,
} from "@/types";
import type { ServiceManager } from "@/libs/service-manage";
import { type TaskItem } from "@/types/task";
import type { ProviderProfileLevel } from "@/types/config";
import { isEmpty } from "radashi";
import {
  ToolBudgetExceededError,
  ToolPolicyBlockedError,
  type ToolDefinitionMap,
  type ToolExecutionContext,
} from "@/services/tools";
import {
  createIntentRequestExecutionContext as runCreateIntentRequestExecutionContext,
  executeIntentRequests as runIntentRequests,
  handleIntentRequestRuntime as runHandleIntentRequestRuntime,
  type IntentRequestExecutionResult,
} from "./intent-request";
import {
  createContinuationFormalConversationTask as runCreateContinuationFormalConversationTask,
} from "./intent-request/execution-helpers";
import {
  exportPredictionPrompt as runExportPredictionPrompt,
  exportRuntimeSystemPrompt as runExportRuntimeSystemPrompt,
  exportUserPrompt as runExportUserPrompt,
  loadSystemRules as runLoadSystemRules,
} from "./prompt";
import {
  createFallbackPostFollowUpContinuation,
  normalizePostFollowUpContinuation,
  exportPostFollowUpPrompt as runExportPostFollowUpPrompt,
  exportPostFollowUpUserPrompt as runExportPostFollowUpUserPrompt,
  PostFollowUpContinuationSchema,
  POST_FOLLOW_UP_MAX_OUTPUT_TOKENS,
  sliceRecentAssistantOutput,
} from "./post-follow-up";
import {
  type IntentControlInput,
  type IntentExecutionPolicy,
  type PredictedIntent,
} from "./user-intent";
import type { Logger } from "@/libs/log";
import { UserIntentPredictionManager } from "./user-intent/user-intent-prediction-manager";
import {
  finalizeChatTurn as runFinalizeChatTurn,
  type RuntimeChatFinalizationResult,
} from "./finalize";
import { prepareExecutionContext as runPrepareExecutionContext } from "./prepare";
import {
  resolveRuntimeService,
  resolveToolService,
  resolveTransportModelProfile,
  shouldReportIntentRequestLogs,
} from "./service-access";
import type { RuntimeMemoryItem } from "./memory-item";
import type { Transport, TransportModelProfile } from "../transport";
import {
  ContextManager,
  type SessionMemoryClearPolicy,
} from "./context-manager";

type RuntimeOptions = {
  logger?: Logger;
};

const summarizeRuntimeValue = (value: unknown, maxLength = 320): string => {
  let serialized = "";

  if (typeof value === "string") {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(value) ?? String(value);
    } catch {
      serialized = String(value);
    }
  }

  const normalized = serialized.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  if (maxLength <= 3) {
    return normalized.slice(0, maxLength);
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const resolveToolEndReasonCode = (error: unknown) => {
  if (error instanceof ToolBudgetExceededError) {
    return "tool_budget_exceeded" as const;
  }

  if (error instanceof ToolPolicyBlockedError) {
    return "tool_blocked" as const;
  }

  return "tool_error" as const;
};

export class Runtime {
  #serviceManager: ServiceManager;
  #currentTask: TaskItem | null = null;
  #contextManager: ContextManager;
  #userIntentPredictionManager: UserIntentPredictionManager;
  #systemRules: string;
  #logger: Logger | undefined;

  constructor(serviceManager: ServiceManager, options: RuntimeOptions = {}) {
    this.#serviceManager = serviceManager;
    this.#contextManager = new ContextManager();
    this.#userIntentPredictionManager = new UserIntentPredictionManager();
    this.#systemRules = "";
    this.#logger = options.logger;
  }

  /**
   * 构造 Intent Request 安全检查上下文。
   * @description
   * 当前没有激活任务时，无法安全地校验会话绑定信息。
   */
  #createIntentRequestSafetyContext(): IntentRequestSafetyContext | null {
    if (!this.#currentTask) {
      return null;
    }

    return {
      sessionId: this.#currentTask.sessionId,
      chatId: this.#currentTask.chatId,
      hasActiveToolContext: this.#contextManager.hasActiveToolContext(),
    };
  }

  /**
   * 获取当前激活任务。
   * @description
   * prompt 导出和会话编排都依赖当前任务上下文。
   * 这里显式收口约束，避免在调用点通过类型断言隐式跳过空值检查。
   */
  #getCurrentTaskOrThrow(): TaskItem {
    if (!this.#currentTask) {
      throw new Error("Runtime currentTask is missing");
    }

    return this.#currentTask;
  }

  /**
   * 获取独立的 Intent 预判提示词。
   */
  public exportIntentPrompt() {
    return runExportPredictionPrompt();
  }

  /**
   * 获取独立的 FOLLOW_UP 预处理提示词。
   */
  public exportPostFollowUpPrompt() {
    return runExportPostFollowUpPrompt();
  }

  /**
   * 导出当前 session 的 Intent Policy 提示词片段。
   */
  public exportIntentPolicyPrompt(sessionId: string) {
    return this.#userIntentPredictionManager.exportIntentPolicyPrompt(
      sessionId,
    );
  }

  /**
   * 写入当前 session 的预测结果。
   * @description
   * Runtime 只暴露高层动作，不向外泄漏 user-intent 内部 manager 对象。
   */
  public setPredictedIntent(
    sessionId: string,
    input: Omit<PredictedIntent, "updatedAt">,
  ) {
    this.#userIntentPredictionManager.setPredictedIntent(sessionId, input);
  }

  /**
   * 在预测失败时写入 fallback 预测结果。
   */
  public setFallbackPredictedIntent(sessionId: string) {
    this.#userIntentPredictionManager.setFallbackPredictedIntent(sessionId);
  }

  /**
   * 解析当前 session 的意图执行策略。
   */
  public resolveIntentPolicy(
    sessionId: string,
    input: Omit<IntentControlInput, "predictedIntent">,
  ) {
    return this.#userIntentPredictionManager.resolveIntentPolicy(
      sessionId,
      input,
    );
  }

  /**
   * 写入当前 session 的意图执行策略。
   */
  public setIntentPolicy(
    sessionId: string,
    input: Omit<IntentExecutionPolicy, "updatedAt">,
  ) {
    this.#userIntentPredictionManager.setIntentPolicy(sessionId, input);
  }

  /* ==================== */
  /* Public getter/setter */
  /* ==================== */

  set currentTask(task: TaskItem) {
    this.#currentTask = task;
    this.#contextManager.syncTask(task);
  }

  /* ==================== */
  /*   Public Methods     */
  /* ==================== */

  /**
   * 从文件中加载系统规则
   * @param file 系统规则文件路径
   */
  public async loadSystemRules(file: string) {
    try {
      this.#systemRules = await runLoadSystemRules(file);
    } catch (error) {
      this.#systemRules = "";
      throw error;
    }
  }

  /**
   * 输出系统提示词
   * @description 输出来自Runtime Context的数据和系统内部强制规范提示词文本
   * @returns 系统提示词文本
   */
  public async exportSystemPrompt(): Promise<string> {
    return runExportRuntimeSystemPrompt({
      runtimeService: resolveRuntimeService(this.#serviceManager),
      systemRules: this.#systemRules,
      sessionId: this.#currentTask?.sessionId ?? "",
      promptContext: this.#contextManager.createPromptContextSnapshot(),
      exportIntentPolicyPrompt: (sessionId) => {
        return this.exportIntentPolicyPrompt(sessionId);
      },
    });
  }

  /**
   * 输出用户输入提示词
   * @returns 用户输入提示词文本
   */
  public exportUserPrompt(): string {
    return runExportUserPrompt(this.#getCurrentTaskOrThrow());
  }

  /**
   * 输出当前 FOLLOW_UP 预处理任务的用户输入提示词。
   */
  public exportPostFollowUpUserPrompt() {
    return runExportPostFollowUpUserPrompt({
      originalUserInput: this.getCurrentChatOriginalUserInput(),
      rawFollowUpIntent: this.exportUserPrompt(),
      chainRound: this.getCurrentChainRound(),
      recentAssistantOutput: sliceRecentAssistantOutput(
        this.getAccumulatedAssistantOutput(),
      ),
    });
  }

  /**
   * 追加 assistant 可见输出到上下文。
   * @description
   * 这里只记录最终会展示给用户的可见文本，不处理 intentRequestText，
   * 这样后续 follow-up 续跑时看到的上下文才与用户真实看到的输出一致。
   */
  public appendAssistantOutput(textDelta: string) {
    this.#contextManager.appendAssistantOutput(textDelta);
  }

  /**
   * 记录当前 chat 最近一轮完整的 assistant 可见输出。
   * @description
   * accumulatedAssistantOutput 用于给后续 follow-up 轮次提供上下文；
   * lastAssistantOutput 只用于最终完成消息，避免把多轮编排文本直接拼成最终答案。
   */
  public setLastAssistantOutput(text: string) {
    this.#contextManager.setLastAssistantOutput(text);
  }

  /**
   * 提交当前 session 最近一轮稳定对话。
   */
  public commitSessionTurn(userInput: string, assistantOutput: string) {
    this.#contextManager.commitSessionTurn(userInput, assistantOutput);
  }

  /**
   * 获取当前 chat 的原始用户输入。
   */
  public getCurrentChatOriginalUserInput() {
    return this.#contextManager.getCurrentChatOriginalUserInput();
  }

  /**
   * 读取当前 chat 已累计的 assistant 可见输出。
   * @description
   * FOLLOW_UP 结束时需要把整段累计输出作为最终结果，
   * 避免最终 complete 事件只携带最后一轮的文本。
   */
  public getAccumulatedAssistantOutput() {
    return this.#contextManager.getAccumulatedAssistantOutput();
  }

  /**
   * 读取当前 chat 最近一轮完整的 assistant 可见输出。
   */
  public getLastAssistantOutput() {
    return this.#contextManager.getLastAssistantOutput();
  }

  /**
   * 写入一次性的 follow-up continuation 上下文。
   * @description
   * 这份上下文只服务下一轮 internal formal conversation，
   * 不属于用户输入，也不进入长期 conversation continuity。
   */
  public setContinuationContext(input: {
    summary: string;
    nextPrompt: string;
    avoidRepeat?: string;
  }) {
    this.#contextManager.setContinuationContext(input);
  }

  /**
   * 清空当前一次性 continuation 上下文。
   */
  public clearContinuationContext() {
    this.#contextManager.clearContinuationContext();
  }

  /**
   * 读取当前 continuation 上下文。
   */
  public getContinuationContext() {
    return this.#contextManager.getContinuationContext();
  }

  public activateToolContext() {
    this.#contextManager.activateToolContext();
  }

  public setToolContextMode(mode: "active" | "finished" | "ended") {
    this.#contextManager.setToolContextMode(mode);
  }

  public clearToolContext() {
    this.#contextManager.clearToolContext();
  }

  public hasActiveToolContext() {
    return this.#contextManager.hasActiveToolContext();
  }

  public getToolContext() {
    return this.#contextManager.getToolContext();
  }

  /**
   * 写入指定 scope 的记忆上下文。
   * @description
   * 0.10 里 session 级记忆默认持续驻留，直到显式覆盖或清空。
   * 0.11 会在这个边界上补充自动失效和策略化移除。
   */
  public setMemoryContext(
    scope: MemoryScope,
    outputs: RuntimeMemoryItem[],
    options: {
      query?: string;
      reason?: string;
    } = {},
  ) {
    this.#contextManager.setMemoryContext(scope, outputs, options);
  }

  /**
   * 记录一次已执行但未命中的记忆搜索。
   */
  public setMemorySearchMiss(
    scope: MemoryScope,
    options: {
      query: string;
      reason: string;
    },
  ) {
    this.#contextManager.setMemorySearchMiss(scope, options);
  }

  /**
   * 记录一次记忆搜索结果。
   */
  public recordMemorySearchResult(
    scope: MemoryScope,
    options: {
      words: string;
      outputs: RuntimeMemoryItem[];
      reason?: string;
    },
  ) {
    this.#contextManager.recordMemorySearchResult(scope, options);
  }

  /**
   * 清空记忆上下文。
   * @description
   * 当前只支持显式清空。
   * 0.11 会在 session 级记忆生命周期完善后，
   * 通过 clearSessionMemoryByPolicy 承接自动卸载策略。
   */
  public clearMemoryContext(scope?: MemoryScope) {
    this.#contextManager.clearMemoryContext(scope);
  }

  /**
   * 读取记忆上下文快照。
   */
  public getMemoryContext(scope: MemoryScope) {
    return this.#contextManager.getMemoryContext(scope);
  }

  /**
   * 读取当前 session 的完整记忆快照。
   * @description
   * 预留给 0.11 的生命周期策略层使用；
   * 当前阶段只提供只读快照，不附带自动移除逻辑。
   */
  public getSessionMemorySnapshot() {
    return this.#contextManager.getSessionMemorySnapshot();
  }

  /**
   * 预留 session 级记忆生命周期清理入口。
   * @description
   * 0.10 不实现策略化移除，只保留统一入口，
   * 让 0.11 可以在不改动 Core 热路径签名的前提下接入记忆卸载策略。
   */
  public clearSessionMemoryByPolicy(
    policy: SessionMemoryClearPolicy,
    options: {
      scope?: MemoryScope;
    } = {},
  ) {
    this.#contextManager.clearSessionMemoryByPolicy(policy, options);
  }

  /**
   * 读取 Transport 使用的模型档位配置。
   * @description
   * Runtime 只负责提供模型参数，不负责 transport 适配器组装。
   */
  public getTransportModelProfile(
    level: ProviderProfileLevel = "balanced",
  ): TransportModelProfile {
    return resolveTransportModelProfile(this.#serviceManager, level);
  }

  /**
   * 读取 formal conversation 的输出 token 上限。
   */
  public getFormalConversationMaxOutputTokens() {
    return resolveRuntimeService(
      this.#serviceManager,
    ).getFormalConversationMaxOutputTokens();
  }

  /**
   * 读取 formal conversation 的 tools 多步调用上限。
   */
  public getFormalConversationMaxToolSteps() {
    return resolveRuntimeService(
      this.#serviceManager,
    ).getFormalConversationMaxToolSteps();
  }

  /**
   * 读取 formal conversation 的输出预算。
   */
  public getFormalConversationOutputBudget() {
    return resolveRuntimeService(
      this.#serviceManager,
    ).getFormalConversationOutputBudget();
  }

  /**
   * 输出 formal conversation 结果分析日志。
   */
  public reportConversationOutputAnalysis(input: {
    finishReason: string;
    visibleTextCharLength: number;
    intentRequestText: string;
    stepCount?: number;
    toolCallCount?: number;
    toolResultCount?: number;
    responseMessageCount?: number;
  }) {
    if (!this.#logger || !shouldReportIntentRequestLogs(this.#serviceManager)) {
      return;
    }

    const outputBudget = this.getFormalConversationOutputBudget();
    const hasIntentRequest = input.intentRequestText.trim() !== "";

    this.#logger.debugJson("Conversation output analyzed", {
      finishReason: input.finishReason,
      maxOutputTokens: outputBudget?.maxOutputTokens ?? null,
      requestTokenReserve: outputBudget?.requestTokenReserve ?? null,
      visibleOutputBudget: outputBudget?.visibleOutputBudget ?? null,
      visibleTextCharLength: input.visibleTextCharLength,
      intentRequestTextLength: input.intentRequestText.length,
      hasIntentRequest,
      stepCount: input.stepCount ?? null,
      toolCallCount: input.toolCallCount ?? null,
      toolResultCount: input.toolResultCount ?? null,
      responseMessageCount: input.responseMessageCount ?? null,
      tokenLimitedWithoutIntentRequest:
        input.finishReason === "length" && !hasIntentRequest,
    });
  }

  /**
   * 输出 POST_FOLLOW_UP 预处理结果分析日志。
   */
  public reportPostFollowUpAnalysis(input: {
    rawFollowUpIntentLength: number;
    recentAssistantOutputLength: number;
    continuationSummaryLength: number;
    continuationNextPromptLength: number;
    fallbackUsed: boolean;
  }) {
    if (!this.#logger || !shouldReportIntentRequestLogs(this.#serviceManager)) {
      return;
    }

    this.#logger.debugJson("Post Follow Up processed", input);
  }

  /**
   * 输出 tool start 调试日志。
   */
  public reportToolCallStarted(input: {
    toolName: string;
    toolCallId?: string;
    input: unknown;
  }) {
    if (!this.#logger || !shouldReportIntentRequestLogs(this.#serviceManager)) {
      return;
    }

    this.#logger.debugJson("Tool call started", input);
  }

  /**
   * 输出 tool finish 调试日志。
   */
  public reportToolCallFinished(input: {
    toolName: string;
    toolCallId?: string;
    input: unknown;
    result?: unknown;
    error?: unknown;
  }) {
    if (!this.#logger || !shouldReportIntentRequestLogs(this.#serviceManager)) {
      return;
    }

    this.#logger.debugJson("Tool call finished", input);
  }

  /**
   * 执行 plain FOLLOW_UP 的内部预处理，并写入 continuation。
   */
  public async preparePostFollowUpContinuation(transport: Transport): Promise<{
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
    fallbackUsed: boolean;
  }> {
    const rawFollowUpIntent = this.exportUserPrompt();
    const recentAssistantOutput = sliceRecentAssistantOutput(
      this.getAccumulatedAssistantOutput(),
    );
    let fallbackUsed = false;
    let continuation =
      createFallbackPostFollowUpContinuation(rawFollowUpIntent);

    const systemPrompt = this.exportPostFollowUpPrompt();
    const userPrompt = this.exportPostFollowUpUserPrompt();

    if (!isEmpty(rawFollowUpIntent)) {
      try {
        const output = await transport.generateObject(systemPrompt, userPrompt, {
          modelProfile: this.getTransportModelProfile("balanced"),
          maxOutputTokens: POST_FOLLOW_UP_MAX_OUTPUT_TOKENS,
          schema: PostFollowUpContinuationSchema,
          schemaName: "post_follow_up_continuation",
          schemaDescription:
            "Structured continuation summary for internal follow-up preprocessing.",
        });
        const parsedContinuation = normalizePostFollowUpContinuation(output);

        if (parsedContinuation) {
          continuation = parsedContinuation;
        } else {
          fallbackUsed = true;
        }
      } catch {
        fallbackUsed = true;
      }
    } else {
      fallbackUsed = true;
    }

    this.setContinuationContext(continuation);
    this.reportPostFollowUpAnalysis({
      rawFollowUpIntentLength: rawFollowUpIntent.length,
      recentAssistantOutputLength: recentAssistantOutput.length,
      continuationSummaryLength: continuation.summary.length,
      continuationNextPromptLength: continuation.nextPrompt.length,
      fallbackUsed,
    });

    return {
      ...continuation,
      fallbackUsed,
    };
  }

  /**
   * 构造一个只依赖 continuation 的 internal formal conversation 任务。
   */
  public createContinuationFormalConversationTask(task: TaskItem) {
    return runCreateContinuationFormalConversationTask(task);
  }

  /**
   * 创建当前正式对话轮次的工具执行上下文。
   * @description
   * Runtime 只负责把当前运行态转换成 ToolService 可消费的高层输入：
   * - 当前 task 必须已经绑定
   * - workspace 来自 RuntimeService
   *
   * 本阶段不在这里接入工具结果摘要或用户可见工具事件，
   * 只为 formal conversation 主链路提供最小 tools 执行上下文。
   */
  public createToolExecutionContext(): ToolExecutionContext {
    this.#getCurrentTaskOrThrow();

    return resolveToolService(this.#serviceManager).createExecutionContext({
      workspace: resolveRuntimeService(this.#serviceManager).getWorkspace(),
    });
  }

  /**
   * 创建当前正式对话轮次可用的工具 registry。
   * @description
   * workflow 只需要拿到当前轮可用 tools，
   * 不应直接接触 ToolService 本体或工具执行上下文细节。
   */
  public createConversationToolRegistry(): ToolDefinitionMap {
    return resolveToolService(this.#serviceManager).createToolProtocolRegistry({
      context: this.createToolExecutionContext(),
    });
  }

  /**
   * 执行当前 formal conversation 产出的 tool calls。
   * @description
   * ai-sdk 继续负责 tool schema 与 tool call 协议；
   * Runtime 接管真实执行和结果回流。
   */
  public async executeConversationToolCalls(toolCalls: Array<{
    toolName: string;
    toolCallId?: string;
    input: unknown;
  }>) {
    const toolService = resolveToolService(this.#serviceManager);
    const context = this.createToolExecutionContext();

    if (toolCalls.length === 0) {
      return {
        ok: false,
        reasonCode: "tool_result_empty" as const,
        reason: "模型进入工具阶段，但没有提供可执行的工具调用。",
      };
    }

    this.activateToolContext();

    for (const toolCall of toolCalls) {
      this.#contextManager.setActiveToolCall({
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        input: toolCall.input,
      });
      this.reportToolCallStarted(toolCall);

      try {
        const result = await toolService.executeTool({
          context,
          toolName: toolCall.toolName,
          toolInput: toolCall.input,
          toolCallId: toolCall.toolCallId,
        });
        const toolError =
          result &&
            typeof result === "object" &&
            !Array.isArray(result) &&
            typeof (result as Record<string, unknown>).error === "string"
            ? String((result as Record<string, unknown>).error)
            : "";

        this.#contextManager.appendToolResult({
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          toolInput: toolCall.input,
          ok: toolError === "",
          result,
          ...(toolError !== "" ? { error: toolError } : {}),
        });
        this.reportToolCallFinished({
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          input: toolCall.input,
          ...(toolError !== "" ? { error: toolError } : { result }),
        });

        if (toolError !== "") {
          this.#contextManager.setToolContextMode("ended");
          this.#contextManager.clearActiveToolCall();
          return {
            ok: false,
            reasonCode: "tool_error" as const,
            reason: toolError,
          };
        }
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : summarizeRuntimeValue(error);
        const reasonCode = resolveToolEndReasonCode(error);

        this.#contextManager.appendToolResult({
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          toolInput: toolCall.input,
          ok: false,
          error: reason,
        });
        this.#contextManager.setToolContextMode("ended");
        this.reportToolCallFinished({
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          input: toolCall.input,
          error,
        });
        this.#contextManager.clearActiveToolCall();

        return {
          ok: false,
          reasonCode,
          reason,
        };
      }
    }

    this.#contextManager.clearActiveToolCall();
    this.#contextManager.setToolContextMode("active");

    return {
      ok: true,
    };
  }

  /**
   * 准备当前 external 任务的执行上下文。
   * @description
   * 这一步只处理用户输入预处理链路：
   * 预测意图 -> fallback -> 解析 policy -> 按 policy 预加载记忆。
   * internal 任务直接跳过，避免 FOLLOW_UP 续跑时发生策略漂移。
   */
  public async prepareExecutionContext(
    task: TaskItem,
    transport: Transport,
  ): Promise<PrepareConversationIntentRequest | null> {
    return runPrepareExecutionContext(task, {
      transport,
      exportIntentPrompt: () => this.exportIntentPrompt(),
      exportUserPrompt: () => this.exportUserPrompt(),
      getTransportModelProfile: (level = "balanced") => {
        return this.getTransportModelProfile(level);
      },
      setPredictedIntent: (sessionId, input) => {
        this.setPredictedIntent(sessionId, input);
      },
      setFallbackPredictedIntent: (sessionId) => {
        this.setFallbackPredictedIntent(sessionId);
      },
      resolveIntentPolicy: (sessionId, input) => {
        return this.resolveIntentPolicy(sessionId, input);
      },
      getCurrentChainRound: () => this.getCurrentChainRound(),
      getCurrentMemoryState: () => {
        return {
          core: this.getMemoryContext("core").status,
          short: this.getMemoryContext("short").status,
          long: this.getMemoryContext("long").status,
        };
      },
      hasSessionHistory: () => this.hasSessionHistory(),
      getFormalConversationOutputBudget: () => {
        return this.getFormalConversationOutputBudget();
      },
      applyTopicArchiveTurnLifecycle: () => {
        this.#contextManager.applyTopicArchiveTurnLifecycle();
      },
      applyTopicIsolation: (topicRelation) => {
        return this.#contextManager.applyTopicIsolation(topicRelation);
      },
    });
  }

  /**
   * 判断当前 session 是否已有稳定对话上下文。
   */
  public hasSessionHistory() {
    return this.#contextManager.hasSessionHistory();
  }

  /**
   * 读取当前 chat 的续跑轮次。
   */
  public getCurrentChainRound() {
    return this.#contextManager.getCurrentChainRound();
  }

  /**
   * 读取已加载记忆所在的 scope。
   */
  public getLoadedMemoryScopeByKey(memoryKey: string): MemoryScope | null {
    return this.#contextManager.getLoadedMemoryScopeByKey(memoryKey);
  }

  /**
   * 按 memory key 卸载已加载的记忆上下文。
   */
  public unloadMemoryContextByKey(memoryKey: string) {
    return this.#contextManager.unloadMemoryContextByKey(memoryKey);
  }

  /**
   * 收束当前 chat 的最终结果。
   * @description
   * Step 4 中，这里统一负责：
   * - 记录本轮完整 assistant 输出
   * - 选择最终完成消息
   * - 提交 session continuity
   * - 生成供 workflow/core 发射的 CHAT_COMPLETED 事件载荷
   *
   * Queue 负责状态推进；
   * 业务事件发射由 workflow/core 负责。
   */
  public finalizeChatTurn(
    task: TaskItem,
    options: {
      resultText: string;
      visibleTextBuffer: string;
    },
  ): RuntimeChatFinalizationResult {
    return runFinalizeChatTurn(this.#contextManager, task, options);
  }

  /**
   * 输出提示词
   * @returns 返回一个数组,第一个元素是系统提示词,第二个元素是用户提示词
   */
  public async exportPrompts(): Promise<[string, string]> {
    const systemPrompt = await this.exportSystemPrompt();
    const userPrompt = this.exportUserPrompt();
    return [systemPrompt, userPrompt];
  }

  /**
   * 解析模型返回的 Intent Request 文本。
   * @param intentRequestText LLM返回的Intent Request请求文本
   */
  public parseIntentRequest(
    intentRequestText: string,
  ): IntentRequestHandleResult {
    return runHandleIntentRequestRuntime({
      intentRequestText,
      safetyContext: this.#createIntentRequestSafetyContext(),
      shouldReportLogs: shouldReportIntentRequestLogs(this.#serviceManager),
      logger: this.#logger,
    });
  }

  /**
   * 执行安全通过的 Intent Request。
   * @description
   * Runtime 作为上下文归口层，负责把 request 执行映射到 memory context
   * 与 follow-up task 结果；Queue 的状态推进仍由 core.ts 统一应用。
   */
  public async executeIntentRequests(
    task: TaskItem,
    requests: IntentRequest[],
  ): Promise<IntentRequestExecutionResult> {
    return runIntentRequests(
      task,
      requests,
      runCreateIntentRequestExecutionContext({
        serviceManager: this.#serviceManager,
        contextManager: this.#contextManager,
        setIntentPolicy: (sessionId, policy) => {
          this.setIntentPolicy(sessionId, policy);
        },
      }),
    );
  }
}
