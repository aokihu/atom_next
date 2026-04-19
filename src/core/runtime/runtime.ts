import type {
  UUID,
  ISOTimeString,
  EmptyString,
  IntentRequestHandleResult,
  IntentRequestSafetyContext,
  RejectedIntentRequest,
  IntentRequestDispatchResult,
  MemoryScope,
  RuntimeMemoryOutput,
} from "@/types";
import { MEMORY_SCOPES } from "@/types";
import type { ServiceManager } from "@/libs/service-manage";
import type { RuntimeService } from "@/services/runtime";
import intentRequestPromptText from "@/assets/prompts/intent_request_prompt.md" with {
  type: "text",
};
import intentPromptText from "@/assets/prompts/intent.md" with {
  type: "text",
};
import systemPromptText from "@/assets/prompts/system.md" with {
  type: "text",
};
import memoryPromptText from "@/assets/prompts/memory.md" with {
  type: "text",
};
import followUpPromptText from "@/assets/prompts/follow_up_prompt.md" with {
  type: "text",
};
import { TaskSource, type TaskItem } from "@/types/task";
import { IntentRequestSafetyIssueCode } from "@/types";
import { isEmpty, isNumber, sleep } from "radashi";
import {
  checkIntentRequestSafety,
  dispatchIntentRequests,
  parseIntentRequests,
} from "./intent-request";
import {
  createRuntimeIntentContext,
  type RuntimeIntentContext,
} from "./intent-prediction";

const WATCHMAN_WAIT_INTERVAL = 100;

type ExportPromptOptions = {
  ignoreWatchman?: boolean;
};

/**
 * ISO 8601 标准时间格式类型
 * 格式: YYYY-MM-DDTHH:mm:ss.sssZ
 * 例如: 2024-01-01T12:00:00.000Z
 */

type RuntimeContext = {
  meta: {
    sessionId: UUID | EmptyString; // 会话的标识
    round: number; // 会话的轮数,计数从1开始
  };
  channel: {
    source: TaskSource;
  };
  followUp?: {
    chatId: UUID | EmptyString; // 当前续跑上下文所属的 chat ID
    chainRound: number | null; // 内部连续会话轮次,外部任务保持空值
    originalUserInput: string; // 当前 chat 第一次提交时的原始用户输入
    accumulatedAssistantOutput: string; // 当前 chat 下累计的 assistant 可见输出
    lastAssistantOutput: string; // 当前 chat 最近一轮完整的 assistant 可见输出
  };
};

type RuntimeConversationContext = {
  lastUserInput: string;
  lastAssistantOutput: string;
  updatedAt: number | null;
};

type RuntimeSessionContext = {
  intent: RuntimeIntentContext;
  memory: {
    core: RuntimeMemoryScopeContext;
    short: RuntimeMemoryScopeContext;
    long: RuntimeMemoryScopeContext;
  };
  conversation: RuntimeConversationContext;
};

type SessionMemoryClearPolicy =
  | "manual"
  | "topic_change"
  | "session_reset"
  | "lifecycle";

type RuntimeTaskSession = {
  sessionId: UUID;
  chatId: UUID;
  round: number;
};

type RuntimeMemoryScopeStatus = "idle" | "loaded" | "empty";

type RuntimeMemoryScopeContext = {
  status: RuntimeMemoryScopeStatus;
  query: string;
  reason: string;
  output: RuntimeMemoryOutput | null;
  updatedAt: number | null;
};

const createRuntimeMemoryScopeContext = (): RuntimeMemoryScopeContext => {
  return {
    status: "idle",
    query: "",
    reason: "",
    output: null,
    updatedAt: null,
  };
};

const createRuntimeMemoryContext = () => {
  return {
    core: createRuntimeMemoryScopeContext(),
    short: createRuntimeMemoryScopeContext(),
    long: createRuntimeMemoryScopeContext(),
  };
};

const createRuntimeConversationContext = (): RuntimeConversationContext => {
  return {
    lastUserInput: "",
    lastAssistantOutput: "",
    updatedAt: null,
  };
};

const createRuntimeSessionContext = (): RuntimeSessionContext => {
  return {
    intent: createRuntimeIntentContext(),
    memory: createRuntimeMemoryContext(),
    conversation: createRuntimeConversationContext(),
  };
};

const MEMORY_SCOPE_TAGS: Record<MemoryScope, "Core" | "Long" | "Short"> = {
  core: "Core",
  long: "Long",
  short: "Short",
};

export class Runtime {
  #serviceManager: ServiceManager;
  #currentTask: TaskItem | null = null;
  #taskSessions: RuntimeTaskSession[];
  #sessionContexts: Map<UUID, RuntimeSessionContext>;
  #context: RuntimeContext;
  #systemRules: string;

  constructor(serviceManager: ServiceManager) {
    // [Milestone 0.1]
    // 这里暂时不对session数组做任何处理
    this.#serviceManager = serviceManager;
    this.#taskSessions = [];
    this.#sessionContexts = new Map();

    // 系统规则提示词
    this.#systemRules = "";

    this.#context = {
      meta: {
        sessionId: "",
        round: 1,
      },
      channel: {
        source: TaskSource.EXTERNAL,
      },
    } satisfies RuntimeContext;
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
   * 读取任务的内部续跑轮次。
   */
  #parseTaskChainRound(task: TaskItem) {
    const chainRound = (
      task as TaskItem & {
        chain_round?: number;
      }
    ).chain_round;

    if (!isNumber(chainRound) || chainRound < 1) {
      return null;
    }

    return chainRound;
  }

  #getActiveSessionContext() {
    const sessionId = this.#context.meta.sessionId;

    if (isEmpty(sessionId)) {
      return createRuntimeSessionContext();
    }

    let sessionContext = this.#sessionContexts.get(sessionId as UUID);

    if (!sessionContext) {
      sessionContext = createRuntimeSessionContext();
      this.#sessionContexts.set(sessionId as UUID, sessionContext);
    }

    return sessionContext;
  }

  /**
   * 获取或初始化 FollowUp 上下文。
   * @description
   * FollowUp 只是一块可选上下文，不应该在 Runtime 初始化时强制存在。
   * 当真正进入任务绑定流程后，才按当前 chat 创建最小上下文。
   */
  #getOrCreateFollowUpContext() {
    if (!this.#context.followUp) {
      this.#context.followUp = {
        chatId: "",
        chainRound: null,
        originalUserInput: "",
        accumulatedAssistantOutput: "",
        lastAssistantOutput: "",
      };
    }

    return this.#context.followUp;
  }

  /**
   * 同步当前任务对应的外部对话轮次。
   */
  #syncTaskRound(task: TaskItem) {
    const existingTaskSession = this.#taskSessions.find((item) => {
      return item.sessionId === task.sessionId && item.chatId === task.chatId;
    });

    if (existingTaskSession) {
      this.#context.meta.round = existingTaskSession.round;
      return;
    }

    const sessionRounds = this.#taskSessions
      .filter((item) => item.sessionId === task.sessionId)
      .map((item) => item.round);
    const nextRound =
      sessionRounds.length === 0 ? 1 : Math.max(...sessionRounds) + 1;

    this.#taskSessions.push({
      sessionId: task.sessionId,
      chatId: task.chatId,
      round: nextRound,
    });
    this.#context.meta.round = nextRound;
  }

  /**
   * 将当前任务同步到 Runtime Context。
   */
  #syncContextWithTask(task: TaskItem) {
    const followUp = this.#getOrCreateFollowUpContext();
    const previousSessionId = this.#context.meta.sessionId;
    const previousChatId = followUp.chatId;
    const hasSessionChanged = previousSessionId !== task.sessionId;
    const hasChatChanged = previousChatId !== task.chatId;

    this.#syncTaskRound(task);

    this.#context.meta.sessionId = task.sessionId;
    this.#context.channel.source = task.source;
    this.#getActiveSessionContext();
    followUp.chatId = task.chatId;
    followUp.chainRound = this.#parseTaskChainRound(task);

    if (hasChatChanged) {
      // chat 发生变化意味着进入了新的外部对话轮次，
      // 已累计的 assistant 输出必须归零，避免串到下一个 chat。
      followUp.accumulatedAssistantOutput = "";
      followUp.lastAssistantOutput = "";
    }

    if (task.source === TaskSource.EXTERNAL) {
      // 外部任务代表一次新的用户提交。
      // 这里把当前 payload 文本保存为该 chat 的原始用户输入，
      // 后续内部续跑只复用这份上下文，不要求再次完整提交。
      followUp.originalUserInput = this.#convertTaskPayloadToPrompt(task);
      return;
    }

    if (hasChatChanged || hasSessionChanged) {
      followUp.originalUserInput = "";
    }
  }

  #convertConversationContextToPrompt() {
    const conversation = this.#getActiveSessionContext().conversation;

    if (conversation.updatedAt === null) {
      return ["<Conversation></Conversation>"];
    }

    return [
      "<Conversation>",
      "<LastUserInput>",
      conversation.lastUserInput,
      "</LastUserInput>",
      "<LastAssistantOutput>",
      conversation.lastAssistantOutput,
      "</LastAssistantOutput>",
      "</Conversation>",
    ];
  }

  /**
   * 将可选的 FollowUp 上下文转换成提示词片段。
   * @description
   * FollowUp 是一块可选上下文，没有任务绑定时不输出该区块，
   * 避免把空的续跑语义强行注入到所有系统提示词中。
   */
  #convertFollowUpContextToPrompt() {
    if (!this.#context.followUp) {
      return [];
    }

    return [
      "<FollowUp>",
      `<ChatId>${this.#context.followUp.chatId}</ChatId>`,
      `<ChainRound>${this.#context.followUp.chainRound ?? ""}</ChainRound>`,
      "<OriginalUserInput>",
      this.#context.followUp.originalUserInput,
      "</OriginalUserInput>",
      "<AccumulatedAssistantOutput>",
      this.#context.followUp.accumulatedAssistantOutput,
      "</AccumulatedAssistantOutput>",
      "</FollowUp>",
    ];
  }

  /**
   * 将意图上下文转换成提示词片段。
   */
  #convertIntentContextToPrompt() {
    const intent = this.#getActiveSessionContext().intent;

    if (intent.updatedAt === null) {
      return ["<Intent></Intent>"];
    }

    return [
      "<Intent>",
      `<SessionId>${intent.sessionId}</SessionId>`,
      `<Type>${intent.type}</Type>`,
      `<NeedsMemory>${intent.needsMemory}</NeedsMemory>`,
      `<NeedsMemorySave>${intent.needsMemorySave}</NeedsMemorySave>`,
      `<MemoryQuery>${intent.memoryQuery}</MemoryQuery>`,
      `<Confidence>${intent.confidence ?? ""}</Confidence>`,
      "</Intent>",
    ];
  }

  /**
   * 读取指定 scope 的记忆上下文。
   */
  #readMemoryScopeContext(scope: MemoryScope) {
    return this.#getActiveSessionContext().memory[scope];
  }

  /**
   * 将单个 scope 的记忆上下文转换成提示词片段。
   * @description
   * idle 保持空标签；
   * loaded/empty 则写入结构化结果，让 FOLLOW_UP 能区分“已命中”或“已搜索但为空”。
   */
  #convertMemoryScopeContextToPrompt(scope: MemoryScope) {
    const tag = MEMORY_SCOPE_TAGS[scope];
    const memoryContext = this.#readMemoryScopeContext(scope);

    if (memoryContext.status === "idle") {
      return [`<${tag}></${tag}>`];
    }

    const prompt = [`<${tag}>`, `<Status>${memoryContext.status}</Status>`];

    if (!isEmpty(memoryContext.query)) {
      prompt.push(`<Query>${memoryContext.query}</Query>`);
    }

    if (!isEmpty(memoryContext.reason)) {
      prompt.push(`<Reason>${memoryContext.reason}</Reason>`);
    }

    if (memoryContext.status === "loaded" && memoryContext.output) {
      const { output } = memoryContext;

      prompt.push(
        "<MemoryItem>",
        `<Key>${output.memory.key}</Key>`,
        "<Text>",
        output.memory.text,
        "</Text>",
        "<Meta>",
        `<CreatedAt>${output.memory.meta.created_at}</CreatedAt>`,
        `<UpdatedAt>${output.memory.meta.updated_at}</UpdatedAt>`,
        `<Score>${output.memory.meta.score}</Score>`,
        `<Status>${output.memory.meta.status}</Status>`,
        `<Confidence>${output.memory.meta.confidence}</Confidence>`,
        `<Type>${output.memory.meta.type}</Type>`,
        "</Meta>",
        "<Retrieval>",
        `<Mode>${output.retrieval.mode}</Mode>`,
        `<Relevance>${output.retrieval.relevance}</Relevance>`,
        `<Reason>${output.retrieval.reason}</Reason>`,
        "</Retrieval>",
      );

      if (output.links.length === 0) {
        prompt.push("<Links></Links>");
      } else {
        prompt.push("<Links>");

        for (const link of output.links) {
          prompt.push(
            "<Link>",
            `<TargetMemoryKey>${link.target_memory_key}</TargetMemoryKey>`,
            `<TargetSummary>${link.target_summary}</TargetSummary>`,
            `<LinkType>${link.link_type}</LinkType>`,
            `<Term>${link.term}</Term>`,
            `<Weight>${link.weight}</Weight>`,
            "</Link>",
          );
        }

        prompt.push("</Links>");
      }

      prompt.push("</MemoryItem>");
    }

    prompt.push(`</${tag}>`);
    return prompt;
  }

  /**
   * 将RuntimeContext转换成提示词格式
   */
  #convertContextToPrompt() {
    const prompt = [
      "<Context>",
      // 会话元数据
      "<Meta>",
      `Session ID = ${this.#context.meta.sessionId}`,
      `Time = ${new Date().toISOString()}`,
      `Round = ${this.#context.meta.round}`,
      "</Meta>",
      // 会话通道数据
      "<Channel>",
      `Source = ${this.#context.channel.source}`,
      "</Channel>",
      ...this.#convertConversationContextToPrompt(),
      ...this.#convertIntentContextToPrompt(),
      // 记忆数据
      "<Memory>",
      ...this.#convertMemoryScopeContextToPrompt("core"),
      ...this.#convertMemoryScopeContextToPrompt("long"),
      ...this.#convertMemoryScopeContextToPrompt("short"),
      "</Memory>",
      ...this.#convertFollowUpContextToPrompt(),
      "</Context>",
    ];

    return prompt.join("\n");
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
    this.#syncContextWithTask(task);
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
    const runtimePrompt = this.#convertContextToPrompt();
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
    if (isEmpty(textDelta)) {
      return;
    }

    this.#getOrCreateFollowUpContext().accumulatedAssistantOutput += textDelta;
  }

  /**
   * 记录当前 chat 最近一轮完整的 assistant 可见输出。
   * @description
   * accumulatedAssistantOutput 用于给后续 follow-up 轮次提供上下文；
   * lastAssistantOutput 只用于最终完成消息，避免把多轮编排文本直接拼成最终答案。
   */
  public setLastAssistantOutput(text: string) {
    this.#getOrCreateFollowUpContext().lastAssistantOutput = text;
  }

  /**
   * 提交当前 session 最近一轮稳定对话。
   */
  public commitSessionTurn(userInput: string, assistantOutput: string) {
    const sessionContext = this.#getActiveSessionContext();

    sessionContext.conversation = {
      lastUserInput: userInput.trim(),
      lastAssistantOutput: assistantOutput.trim(),
      updatedAt: Date.now(),
    };
  }

  /**
   * 获取当前 chat 的原始用户输入。
   */
  public getCurrentChatOriginalUserInput() {
    return this.#context.followUp?.originalUserInput ?? "";
  }

  /**
   * 读取当前 chat 已累计的 assistant 可见输出。
   * @description
   * FOLLOW_UP 结束时需要把整段累计输出作为最终结果，
   * 避免最终 complete 事件只携带最后一轮的文本。
   */
  public getAccumulatedAssistantOutput() {
    return this.#context.followUp?.accumulatedAssistantOutput ?? "";
  }

  /**
   * 读取当前 chat 最近一轮完整的 assistant 可见输出。
   */
  public getLastAssistantOutput() {
    return this.#context.followUp?.lastAssistantOutput ?? "";
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
    this.#getActiveSessionContext().memory[scope] = {
      status: "loaded",
      query: options.query?.trim() ?? "",
      reason: options.reason?.trim() ?? "",
      output: structuredClone(output),
      updatedAt: Date.now(),
    };
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
    this.#getActiveSessionContext().memory[scope] = {
      status: "empty",
      query: options.query.trim(),
      reason: options.reason.trim(),
      output: null,
      updatedAt: Date.now(),
    };
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
    if (options.output) {
      this.setMemoryContext(scope, options.output, {
        query: options.words,
        reason: options.reason,
      });
      return;
    }

    this.setMemorySearchMiss(scope, {
      query: options.words,
      reason:
        options.reason?.trim()
        || `No ${scope} memory matched ${options.words.trim()}`,
    });
  }

  /**
   * 清空记忆上下文。
   * @description
   * 当前只支持显式清空。
   * 0.11 会在 session 级记忆生命周期完善后，
   * 通过 clearSessionMemoryByPolicy 承接自动卸载策略。
   */
  public clearMemoryContext(scope?: MemoryScope) {
    const sessionContext = this.#getActiveSessionContext();

    if (scope) {
      sessionContext.memory[scope] = createRuntimeMemoryScopeContext();
      return;
    }

    sessionContext.memory = createRuntimeMemoryContext();
  }

  /**
   * 读取记忆上下文快照。
   */
  public getMemoryContext(scope: MemoryScope) {
    return structuredClone(this.#getActiveSessionContext().memory[scope]);
  }

  /**
   * 读取当前 session 的完整记忆快照。
   * @description
   * 预留给 0.11 的生命周期策略层使用；
   * 当前阶段只提供只读快照，不附带自动移除逻辑。
   */
  public getSessionMemorySnapshot() {
    return structuredClone(this.#getActiveSessionContext().memory);
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
    if (policy === "manual") {
      this.clearMemoryContext(options.scope);
    }
  }

  /**
   * 写入当前 chat 的意图上下文。
   */
  public setIntentContext(
    input: Omit<RuntimeIntentContext, "updatedAt">,
  ) {
    this.#getActiveSessionContext().intent = {
      ...input,
      updatedAt: Date.now(),
    };
  }

  /**
   * 清空意图上下文。
   */
  public clearIntentContext() {
    this.#getActiveSessionContext().intent = createRuntimeIntentContext();
  }

  /**
   * 读取意图上下文快照。
   */
  public getIntentContext() {
    return structuredClone(this.#getActiveSessionContext().intent);
  }

  /**
   * 读取已加载记忆所在的 scope。
   */
  public getLoadedMemoryScopeByKey(memoryKey: string): MemoryScope | null {
    for (const scope of MEMORY_SCOPES) {
      const memoryContext = this.#getActiveSessionContext().memory[scope];

      if (
        memoryContext.status === "loaded"
        && memoryContext.output?.memory.key === memoryKey
      ) {
        return scope;
      }
    }

    return null;
  }

  /**
   * 按 memory key 卸载已加载的记忆上下文。
   */
  public unloadMemoryContextByKey(memoryKey: string) {
    const scope = this.getLoadedMemoryScopeByKey(memoryKey);

    if (!scope) {
      return false;
    }

    this.clearMemoryContext(scope);
    return true;
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

    const safetyResult = checkIntentRequestSafety(parsedRequests, safetyContext);
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
}
