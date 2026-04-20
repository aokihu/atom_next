import type {
  IntentRequestHandleResult,
  IntentRequest,
  IntentRequestSafetyContext,
  RejectedIntentRequest,
  IntentRequestDispatchResult,
  MemoryScope,
  RuntimeMemoryOutput,
} from "@/types";
import type { ServiceManager } from "@/libs/service-manage";
import type { MemoryService } from "@/services";
import type { RuntimeService } from "@/services/runtime";
import intentRequestPromptText from "@/assets/prompts/intent_request_prompt.md" with { type: "text" };
import intentPromptText from "@/assets/prompts/intent.md" with { type: "text" };
import systemPromptText from "@/assets/prompts/system.md" with { type: "text" };
import memoryPromptText from "@/assets/prompts/memory.md" with { type: "text" };
import followUpPromptText from "@/assets/prompts/follow_up_prompt.md" with { type: "text" };
import { TaskSource, type TaskItem } from "@/types/task";
import type { ChatCompletedEventPayload } from "@/types/event";
import { IntentRequestSafetyIssueCode } from "@/types";
import type { ProviderProfileLevel } from "@/types/config";
import { ChatStatus } from "@/types/chat";
import { isEmpty, sleep } from "radashi";
import {
  checkIntentRequestSafety,
  executeIntentRequests as runIntentRequests,
  dispatchIntentRequests,
  parseIntentRequests,
  type IntentRequestExecutionResult,
} from "./intent-request";
import { convertRuntimeContextToPrompt } from "./prompt/context-prompt";
import { parseIntentPredictionText } from "./user-intent/intent-prediction";
import { UserIntentPredictionManager } from "./user-intent/user-intent-prediction-manager";
import type { Transport, TransportModelProfile } from "../transport";
import {
  ContextManager,
  type SessionMemoryClearPolicy,
} from "./context-manager";

const WATCHMAN_WAIT_INTERVAL = 100;

type ExportPromptOptions = {
  ignoreWatchman?: boolean;
};

type RuntimeChatFinalizationResult = {
  finalMessage: string;
  visibleChunk: string | null;
  completedPayload: ChatCompletedEventPayload;
};

export class Runtime {
  #serviceManager: ServiceManager;
  #currentTask: TaskItem | null = null;
  #contextManager: ContextManager;
  #userIntentPredictionManager: UserIntentPredictionManager;
  #systemRules: string;

  constructor(serviceManager: ServiceManager) {
    this.#serviceManager = serviceManager;
    this.#contextManager = new ContextManager();
    this.#userIntentPredictionManager = new UserIntentPredictionManager();
    this.#systemRules = "";
  }

  /**
   * 从任务中提取文本提示。
   */
  #convertTaskPayloadToPrompt(task: TaskItem) {
    return task.payload
      .filter((payload) => payload.type === "text")
      .map((payload) => payload.data)
      .join("\n");
  }

  /**
   * 将任务转化成提示词
   * @description 从task.payload字段中提取用户的输入信息
   *              整理之后输出,当前只出了文本格式的数据
   */
  #convertTaskToPrompt() {
    return this.#convertTaskPayloadToPrompt(this.#currentTask as TaskItem);
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
    };
  }

  /**
   * 判断当前模式是否允许直接输出 Intent Request 调试日志。
   * @description
   * TUI 和 both 模式会占用当前终端渲染界面，
   * 如果继续向 stdout/stderr 打日志，会直接污染界面显示。
   * 这里先按最小策略收口：只有 server 模式才输出这类调试日志。
   */
  #shouldReportIntentRequestLogs() {
    const runtime = this.#getRuntimeService();
    const mode = runtime.getAllArguments().mode;

    return mode === "server";
  }

  /**
   * 记录被拒绝的 Intent Request。
   */
  #reportRejectedIntentRequests(rejectedRequests: RejectedIntentRequest[]) {
    if (!this.#shouldReportIntentRequestLogs()) {
      return;
    }

    for (const rejectedRequest of rejectedRequests) {
      console.warn(
        "[Intent Request] rejected %s: %s",
        rejectedRequest.request.request,
        rejectedRequest.reason,
      );
    }
  }

  /**
   * 记录分发结果。
   */
  #reportIntentRequestDispatchResults(
    dispatchResults: IntentRequestDispatchResult[],
  ) {
    if (!this.#shouldReportIntentRequestLogs()) {
      return;
    }

    for (const dispatchResult of dispatchResults) {
      console.info(
        "[Intent Request] dispatched %s as %s: %s",
        dispatchResult.request.request,
        dispatchResult.status,
        dispatchResult.message,
      );
    }
  }

  /**
   * 获取 Runtime 服务
   */
  #getRuntimeService() {
    const runtime = this.#serviceManager.getService<RuntimeService>("runtime");

    if (!runtime) {
      throw new Error("Runtime service not found");
    }

    return runtime;
  }

  #getMemoryService() {
    const memory = this.#serviceManager.getService<MemoryService>("memory");

    if (!memory) {
      throw new Error("Memory service not found");
    }

    return memory;
  }

  /**
   * 获取编译后的 AGENTS 提示词
   */
  async #getAgentsPrompt(options: ExportPromptOptions = {}) {
    const runtime = this.#getRuntimeService();

    let hasWarned = false;

    while (true) {
      const status = runtime.getUserAgentPromptStatus();

      if (status.phase === "ready") {
        return runtime.getUserAgentPrompt();
      }

      if (options.ignoreWatchman) {
        return "";
      }

      if (status.phase === "error") {
        throw new Error(status.error ?? "Agent prompt compile failed");
      }

      if (!hasWarned) {
        console.warn(
          "Agent prompt is not ready, waiting for compilation to finish.",
        );
        hasWarned = true;
      }

      await sleep(WATCHMAN_WAIT_INTERVAL);
    }
  }

  /**
   * 获取 Intent Request 的系统提示词。
   * @description
   * Intent Request 总规范和 FOLLOW_UP 专项规范都属于 Runtime(Core) 内置协议，
   * 这里统一拼接，避免调用方自己管理多份提示词顺序。
   */
  async #getIntentRequestPrompt() {
    return [
      systemPromptText,
      intentRequestPromptText,
      memoryPromptText,
      followUpPromptText,
    ]
      .filter((chunk) => chunk.trim() !== "")
      .join("\n\n");
  }

  /**
   * 获取独立的 Intent 预判提示词。
   */
  public exportIntentPrompt() {
    return intentPromptText.trim();
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
    if (await Bun.file(file).exists()) {
      const content = await Bun.file(file).text();
      this.#systemRules = content;
    } else {
      this.#systemRules = "";
      throw new Error(`System rules file not found: ${file}`);
    }
  }

  /**
   * 输出系统提示词
   * @description 输出来自Runtime Context的数据和系统内部强制规范提示词文本
   * @returns 系统提示词文本
   */
  public async exportSystemPrompt(
    options: ExportPromptOptions = {},
  ): Promise<string> {
    const runtimePrompt = convertRuntimeContextToPrompt({
      ...this.#contextManager.createPromptContextSnapshot(),
      intentPolicyPrompt:
        this.#userIntentPredictionManager.exportIntentPolicyPrompt(
          this.#currentTask?.sessionId ?? "",
        ),
    });
    const agentsPrompt = await this.#getAgentsPrompt(options);
    const intentRequestPrompt = await this.#getIntentRequestPrompt();

    return [this.#systemRules, agentsPrompt, intentRequestPrompt, runtimePrompt]
      .filter((chunk) => chunk.trim() !== "")
      .join("\n");
  }

  /**
   * 输出用户输入提示词
   * @returns 用户输入提示词文本
   */
  public exportUserPrompt(): string {
    return this.#convertTaskToPrompt();
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
   * 写入指定 scope 的记忆上下文。
   * @description
   * 0.10 里 session 级记忆默认持续驻留，直到显式覆盖或清空。
   * 0.11 会在这个边界上补充自动失效和策略化移除。
   */
  public setMemoryContext(
    scope: MemoryScope,
    output: RuntimeMemoryOutput,
    options: {
      query?: string;
      reason?: string;
    } = {},
  ) {
    this.#contextManager.setMemoryContext(scope, output, options);
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
      output: RuntimeMemoryOutput | null;
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
   * 写入当前 session 的原始预测意图。
   */
  /**
   * 读取 UserIntentPredictionManager。
   */
  public getUserIntentPredictionManager() {
    return this.#userIntentPredictionManager;
  }

  /**
   * 读取 Transport 使用的模型档位配置。
   * @description
   * Runtime 只负责提供模型参数，不负责 transport 适配器组装。
   */
  public getTransportModelProfile(
    level: ProviderProfileLevel = "balanced",
  ): TransportModelProfile {
    return {
      level,
      ...this.#getRuntimeService().getModelProfileConfigWithLevel(level),
    };
  }

  /**
   * 准备当前 external 任务的执行上下文。
   * @description
   * 这一步只处理用户输入预处理链路：
   * 预测意图 -> fallback -> 解析 policy -> 按 policy 预加载记忆。
   * internal 任务直接跳过，避免 FOLLOW_UP 续跑时发生策略漂移。
   */
  public async prepareExecutionContext(task: TaskItem, transport: Transport) {
    if (task.source !== TaskSource.EXTERNAL) {
      return this.#userIntentPredictionManager.getIntentPolicy(task.sessionId);
    }

    try {
      const predictionText = await transport.generateText(
        this.exportIntentPrompt(),
        this.exportUserPrompt(),
        {
          maxOutputTokens: 120,
          modelProfile: this.getTransportModelProfile("basic"),
        },
      );
      const parsedIntent = parseIntentPredictionText(predictionText);

      this.#userIntentPredictionManager.setPredictedIntent(task.sessionId, {
        sessionId: task.sessionId,
        type: parsedIntent.type,
        needsMemory: parsedIntent.needsMemory,
        needsMemorySave: parsedIntent.needsMemorySave,
        memoryQuery: parsedIntent.memoryQuery,
        confidence: parsedIntent.confidence,
      });
    } catch {
      this.#userIntentPredictionManager.setFallbackPredictedIntent(
        task.sessionId,
      );
    }

    const policy = this.#userIntentPredictionManager.resolveIntentPolicy(
      task.sessionId,
      {
        taskSource: task.source,
        chainRound: this.getCurrentChainRound(),
        currentMemoryState: {
          core: this.getMemoryContext("core").status,
          short: this.getMemoryContext("short").status,
          long: this.getMemoryContext("long").status,
        },
        sessionHistoryAvailable: this.hasSessionHistory(),
      },
    );

    if (!policy.preloadMemory || isEmpty(policy.memoryQuery)) {
      return policy;
    }

    const scope = "long" as MemoryScope;
    const memoryContext = this.getMemoryContext(scope);

    if (
      memoryContext.status !== "idle" &&
      memoryContext.query === policy.memoryQuery
    ) {
      return policy;
    }

    const output = this.#getMemoryService().retrieveRuntimeContext({
      words: policy.memoryQuery,
      scope,
    });

    this.recordMemorySearchResult(scope, {
      words: policy.memoryQuery,
      output,
      reason: output
        ? `Loaded ${scope} memory from intent policy query ${policy.memoryQuery}`
        : `No ${scope} memory matched intent policy query ${policy.memoryQuery}`,
    });

    return policy;
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
   * - 生成 CHAT_COMPLETED 事件载荷
   *
   * Queue 状态推进和事件发射仍由 core.ts 负责。
   */
  public finalizeChatTurn(
    task: TaskItem,
    options: {
      resultText: string;
      visibleTextBuffer: string;
    },
  ): RuntimeChatFinalizationResult {
    this.#contextManager.setLastAssistantOutput(options.resultText);

    const completedMessage = this.#contextManager.getLastAssistantOutput();
    const finalMessage = isEmpty(completedMessage)
      ? this.#contextManager.getAccumulatedAssistantOutput() ||
        options.resultText
      : completedMessage;
    const originalUserInput = this.#contextManager.getCurrentChatOriginalUserInput();

    if (!isEmpty(originalUserInput) && !isEmpty(finalMessage)) {
      this.#contextManager.commitSessionTurn(originalUserInput, finalMessage);
    }

    return {
      finalMessage,
      visibleChunk: isEmpty(options.visibleTextBuffer)
        ? null
        : options.visibleTextBuffer,
      completedPayload: {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: ChatStatus.COMPLETE,
        message: {
          createdAt: Date.now(),
          data: finalMessage,
        },
      },
    };
  }

  /**
   * 输出提示词
   * @returns 返回一个数组,第一个元素是系统提示词,第二个元素是用户提示词
   */
  public async exportPrompts(
    options: ExportPromptOptions = {},
  ): Promise<[string, string]> {
    const systemPrompt = await this.exportSystemPrompt(options);
    const userPrompt = this.exportUserPrompt();
    return [systemPrompt, userPrompt];
  }

  /**
   * 解析LLM返回的Request请求
   * @param intentRequestText LLM返回的Intent Request请求文本
   */
  public parseLLMRequest(intentRequestText: string): IntentRequestHandleResult {
    const parsedRequests = parseIntentRequests(intentRequestText);
    const safetyContext = this.#createIntentRequestSafetyContext();

    if (!safetyContext) {
      return {
        parsedRequests,
        safeRequests: [],
        rejectedRequests: parsedRequests.map((request) => {
          return {
            request,
            code: IntentRequestSafetyIssueCode.MISSING_RUNTIME_CONTEXT,
            reason:
              "Runtime currentTask is missing, cannot validate or dispatch intent request",
          };
        }),
        dispatchResults: [],
      };
    }

    const safetyResult = checkIntentRequestSafety(
      parsedRequests,
      safetyContext,
    );
    const dispatchResults = dispatchIntentRequests(safetyResult.safeRequests);

    this.#reportRejectedIntentRequests(safetyResult.rejectedRequests);
    this.#reportIntentRequestDispatchResults(dispatchResults);

    return {
      parsedRequests,
      safeRequests: safetyResult.safeRequests,
      rejectedRequests: safetyResult.rejectedRequests,
      dispatchResults,
    };
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
    return runIntentRequests(task, requests, {
      memory: this.#getMemoryService(),
      getMemoryContext: (scope) => {
        const memoryContext = this.getMemoryContext(scope);
        return {
          status: memoryContext.status,
          query: memoryContext.query,
        };
      },
      recordMemorySearchResult: (scope, options) => {
        this.recordMemorySearchResult(scope, options);
      },
      setMemoryContext: (scope, output, options) => {
        this.setMemoryContext(scope, output, options);
      },
      getLoadedMemoryScopeByKey: (memoryKey) => {
        return this.getLoadedMemoryScopeByKey(memoryKey);
      },
      unloadMemoryContextByKey: (memoryKey) => {
        return this.unloadMemoryContextByKey(memoryKey);
      },
    });
  }
}
