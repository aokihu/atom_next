/**
 * context-manager/index.ts
 * @description
 * ContextManager 是 Runtime 内部的状态容器。
 *
 * 这个文件只负责：
 * - 持有当前激活 session/chat 的上下文状态
 * - 调用纯函数计算下一个状态
 * - 把结果应用回内部状态
 *
 * 它不负责 prompt 组装，也不负责 intent 策略计算。
 * 相关纯逻辑已经拆到同目录下的小文件中，这里只保留对象生命周期和状态读写入口。
 */
import type {
  EmptyString,
  MemoryScope,
  UUID,
} from "@/types";
import { MEMORY_SCOPES } from "@/types";
import { TaskSource, type TaskItem } from "@/types/task";
import { isEmpty } from "radashi";
import type { RuntimeMemoryItem } from "../memory-item";
import {
  createEmptyMemoryScopeContext,
  createLoadedMemoryScopeContext,
  createMemorySearchResultContext,
} from "./memory-state";
import {
  createRuntimeContinuationContext,
  createRuntimeFollowUpContext,
  createRuntimeMemoryContext,
  createRuntimeMemoryScopeContext,
  createRuntimeSessionContext,
  createRuntimeConversationContext,
} from "./state";
import {
  syncContinuationContext,
  syncFollowUpContext,
  syncTaskSessions,
} from "./task-sync";
import {
  createTopicArchiveMemoryItem,
  createTopicArchiveSummary,
} from "./topic-archive";
import type {
  RuntimeContext,
  RuntimeContinuationContext,
  RuntimePromptContextSnapshot,
  RuntimeSessionContext,
  RuntimeTaskSession,
  SessionMemoryClearPolicy,
} from "./types";

const TOPIC_ARCHIVE_TTL_TURNS = 5;

export type {
  RuntimeConversationContext,
  RuntimeContinuationContext,
  RuntimeFollowUpContext,
  RuntimeMemoryContext,
  RuntimeMemoryScopeContext,
  RuntimeMemoryScopeStatus,
  RuntimePromptContextSnapshot,
  RuntimeSessionContext,
  RuntimeTaskSession,
  SessionMemoryClearPolicy,
} from "./types";

/* ==================== */
/* Context Manager      */
/* ==================== */

/**
 * 管理 Runtime 的会话与上下文状态。
 * @description
 * 这里只负责状态持有与状态应用：
 * - session/chat/follow-up 同步
 * - conversation continuity
 * - memory context
 *
 * prompt 组装、策略计算和外部流程编排继续留在 Runtime 主入口或对应子域中。
 */
export class ContextManager {
  #taskSessions: RuntimeTaskSession[];
  #sessionContexts: Map<UUID, RuntimeSessionContext>;
  #context: RuntimeContext;

  constructor() {
    this.#taskSessions = [];
    this.#sessionContexts = new Map();
    this.#context = {
      meta: {
        sessionId: "",
        round: 1,
      },
      channel: {
        source: TaskSource.EXTERNAL,
      },
    };
  }

  /* ==================== */
  /* Context Access      */
  /* ==================== */

  /**
   * 读取指定 session 的上下文。
   * @description
   * session 不存在时会按需初始化，保证上层逻辑始终拿到可写状态。
   */
  #readSessionContext(sessionId: UUID | EmptyString) {
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
   * 读取当前激活 session 的上下文。
   */
  #getActiveSessionContext() {
    return this.#readSessionContext(this.#context.meta.sessionId);
  }

  /**
   * 读取当前 follow-up 上下文；不存在时创建默认值。
   */
  #getOrCreateFollowUpContext() {
    if (!this.#context.followUp) {
      this.#context.followUp = createRuntimeFollowUpContext();
    }

    return this.#context.followUp;
  }

  /* ==================== */
  /* Task Sync           */
  /* ==================== */

  /**
   * 同步当前激活 task。
   * @description
   * ContextManager 只负责应用已经计算好的状态迁移规则，
   * round 计算和 follow-up 迁移规则都由上面的纯函数负责。
   */
  public syncTask(task: TaskItem) {
    const nextTaskSession = syncTaskSessions(this.#taskSessions, task);
    const previousChatId = this.#context.followUp?.chatId ?? "";
    const nextFollowUp = syncFollowUpContext({
      previousFollowUp: this.#context.followUp,
      previousSessionId: this.#context.meta.sessionId,
      task,
    });
    const nextContinuation = syncContinuationContext({
      previousContinuation: this.#context.continuation,
      previousSessionId: this.#context.meta.sessionId,
      previousChatId,
      task,
    });

    this.#taskSessions = nextTaskSession.taskSessions;
    this.#context.meta.round = nextTaskSession.round;
    this.#context.meta.sessionId = task.sessionId;
    this.#context.channel.source = task.source;
    this.#context.followUp = nextFollowUp;
    this.#context.continuation = nextContinuation;
    this.#getActiveSessionContext();
  }

  /* ==================== */
  /* Prompt Snapshot     */
  /* ==================== */

  /**
   * 导出 prompt 组装所需的只读快照。
   * @description
   * 这里返回的是结构化 snapshot，
   * prompt 子域会基于这份 snapshot 负责最终文本组装。
   */
  public createPromptContextSnapshot(): RuntimePromptContextSnapshot {
    const sessionContext = this.#getActiveSessionContext();

    return {
      sessionId: this.#context.meta.sessionId,
      round: this.#context.meta.round,
      source: this.#context.channel.source,
      followUp: this.#context.followUp
        ? structuredClone(this.#context.followUp)
        : undefined,
      continuation: this.#context.continuation
        ? structuredClone(this.#context.continuation)
        : undefined,
      conversation: structuredClone(sessionContext.conversation),
      memory: structuredClone(sessionContext.memory),
    };
  }

  /* ==================== */
  /* Follow-up Output    */
  /* ==================== */

  public appendAssistantOutput(textDelta: string) {
    if (isEmpty(textDelta)) {
      return;
    }

    this.#getOrCreateFollowUpContext().accumulatedAssistantOutput += textDelta;
  }

  public setLastAssistantOutput(text: string) {
    this.#getOrCreateFollowUpContext().lastAssistantOutput = text;
  }

  public setContinuationContext(input: {
    summary: string;
    nextPrompt: string;
    avoidRepeat?: string;
  }) {
    this.#context.continuation = {
      ...createRuntimeContinuationContext(),
      summary: input.summary.trim(),
      nextPrompt: input.nextPrompt.trim(),
      avoidRepeat: input.avoidRepeat?.trim() ?? "",
      updatedAt: Date.now(),
    };
  }

  public clearContinuationContext() {
    this.#context.continuation = undefined;
  }

  public getContinuationContext(): RuntimeContinuationContext {
    return this.#context.continuation
      ? structuredClone(this.#context.continuation)
      : createRuntimeContinuationContext();
  }

  public commitSessionTurn(userInput: string, assistantOutput: string) {
    const sessionContext = this.#getActiveSessionContext();

    sessionContext.conversation = {
      lastUserInput: userInput.trim(),
      lastAssistantOutput: assistantOutput.trim(),
      updatedAt: Date.now(),
    };
  }

  public clearConversationContext() {
    this.#getActiveSessionContext().conversation =
      createRuntimeConversationContext();
  }

  public getCurrentChatOriginalUserInput() {
    return this.#context.followUp?.originalUserInput ?? "";
  }

  public getAccumulatedAssistantOutput() {
    return this.#context.followUp?.accumulatedAssistantOutput ?? "";
  }

  public getLastAssistantOutput() {
    return this.#context.followUp?.lastAssistantOutput ?? "";
  }

  /* ==================== */
  /* Memory State        */
  /* ==================== */

  public setMemoryContext(
    scope: MemoryScope,
    outputs: RuntimeMemoryItem[],
    options: {
      query?: string;
      reason?: string;
    } = {},
  ) {
    this.#getActiveSessionContext().memory[scope] =
      createLoadedMemoryScopeContext(outputs, options);
  }

  public setMemorySearchMiss(
    scope: MemoryScope,
    options: {
      query: string;
      reason: string;
    },
  ) {
    this.#getActiveSessionContext().memory[scope] =
      createEmptyMemoryScopeContext(options);
  }

  public recordMemorySearchResult(
    scope: MemoryScope,
    options: {
      words: string;
      outputs: RuntimeMemoryItem[];
      reason?: string;
    },
  ) {
    this.#getActiveSessionContext().memory[scope] =
      createMemorySearchResultContext(scope, options);
  }

  public clearMemoryContext(scope?: MemoryScope) {
    const sessionContext = this.#getActiveSessionContext();

    if (scope) {
      sessionContext.memory[scope] = createRuntimeMemoryScopeContext();
      return;
    }

    sessionContext.memory = createRuntimeMemoryContext();
  }

  public applyTopicArchiveTurnLifecycle() {
    const shortMemory = this.#getActiveSessionContext().memory.short;

    if (
      shortMemory.status !== "loaded" ||
      shortMemory.kind !== "topic_archive" ||
      shortMemory.ttlTurnsRemaining === null
    ) {
      return;
    }

    const nextTtl = shortMemory.ttlTurnsRemaining - 1;

    if (nextTtl <= 0) {
      this.clearMemoryContext("short");
      return;
    }

    shortMemory.ttlTurnsRemaining = nextTtl;
    shortMemory.updatedAt = Date.now();
  }

  public applyTopicIsolation(topicRelation: "related" | "unrelated" | "uncertain") {
    const sessionContext = this.#getActiveSessionContext();

    if (sessionContext.conversation.updatedAt === null) {
      return {
        shouldIsolateConversation: false,
        archivedConversationSummary: null,
      };
    }

    if (topicRelation === "related") {
      return {
        shouldIsolateConversation: false,
        archivedConversationSummary: null,
      };
    }

    const archivedConversationSummary = createTopicArchiveSummary(
      sessionContext.conversation,
    );

    sessionContext.memory.short = createLoadedMemoryScopeContext(
      [createTopicArchiveMemoryItem(archivedConversationSummary)],
      {
        query: "topic archive",
        reason: "Archived previous session conversation due to topic change",
        kind: "topic_archive",
        archivedFromConversation: true,
        ttlTurnsRemaining: TOPIC_ARCHIVE_TTL_TURNS,
      },
    );
    this.clearConversationContext();

    return {
      shouldIsolateConversation: true,
      archivedConversationSummary,
    };
  }

  public getMemoryContext(scope: MemoryScope) {
    return structuredClone(this.#getActiveSessionContext().memory[scope]);
  }

  public getSessionMemorySnapshot() {
    return structuredClone(this.#getActiveSessionContext().memory);
  }

  /* ==================== */
  /* Memory Lifecycle    */
  /* ==================== */

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

  /* ==================== */
  /* Conversation State  */
  /* ==================== */

  public hasSessionHistory() {
    return this.#getActiveSessionContext().conversation.updatedAt !== null;
  }

  public getCurrentChainRound() {
    return this.#context.followUp?.chainRound ?? null;
  }

  /* ==================== */
  /* Memory Lookup       */
  /* ==================== */

  public getLoadedMemoryScopeByKey(memoryKey: string): MemoryScope | null {
    for (const scope of MEMORY_SCOPES) {
      const memoryContext = this.#getActiveSessionContext().memory[scope];

      if (
        memoryContext.status === "loaded" &&
        memoryContext.outputs.some((output) => output.memory.key === memoryKey)
      ) {
        return scope;
      }
    }

    return null;
  }

  public unloadMemoryContextByKey(memoryKey: string) {
    const scope = this.getLoadedMemoryScopeByKey(memoryKey);

    if (!scope) {
      return false;
    }

    this.clearMemoryContext(scope);
    return true;
  }
}
