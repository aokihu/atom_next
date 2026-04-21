import type {
  EmptyString,
  MemoryScope,
  RuntimeMemoryOutput,
  UUID,
} from "@/types";
import { MEMORY_SCOPES } from "@/types";
import { TaskSource, type TaskItem } from "@/types/task";
import { isEmpty, isNumber } from "radashi";

type RuntimeContext = {
  meta: {
    sessionId: UUID | EmptyString;
    round: number;
  };
  channel: {
    source: TaskSource;
  };
  followUp?: RuntimeFollowUpContext;
};

export type RuntimeFollowUpContext = {
  chatId: UUID | EmptyString;
  chainRound: number | null;
  originalUserInput: string;
  accumulatedAssistantOutput: string;
  lastAssistantOutput: string;
};

export type RuntimeConversationContext = {
  lastUserInput: string;
  lastAssistantOutput: string;
  updatedAt: number | null;
};

export type RuntimeMemoryScopeStatus = "idle" | "loaded" | "empty";

export type RuntimeMemoryScopeContext = {
  status: RuntimeMemoryScopeStatus;
  query: string;
  reason: string;
  output: RuntimeMemoryOutput | null;
  updatedAt: number | null;
};

type RuntimeMemoryContext = Record<MemoryScope, RuntimeMemoryScopeContext>;

type RuntimeSessionContext = {
  memory: RuntimeMemoryContext;
  conversation: RuntimeConversationContext;
};

export type SessionMemoryClearPolicy =
  | "manual"
  | "topic_change"
  | "session_reset"
  | "lifecycle";

type RuntimeTaskSession = {
  sessionId: UUID;
  chatId: UUID;
  round: number;
};

export type RuntimePromptContextSnapshot = {
  sessionId: UUID | EmptyString;
  round: number;
  source: TaskSource;
  followUp?: RuntimeFollowUpContext;
  conversation: RuntimeConversationContext;
  memory: RuntimeMemoryContext;
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

const createRuntimeMemoryContext = (): RuntimeMemoryContext => {
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
    memory: createRuntimeMemoryContext(),
    conversation: createRuntimeConversationContext(),
  };
};

/**
 * 管理 Runtime 的会话与上下文状态。
 * @description
 * 这里只负责状态持有与读写：
 * - session/chat/follow-up 同步
 * - conversation continuity
 * - memory context
 *
 * Prompt 组装和外部流程编排继续留在 Runtime façade 中。
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

  #convertTaskPayloadToPrompt(task: TaskItem) {
    return task.payload
      .filter((payload) => payload.type === "text")
      .map((payload) => payload.data)
      .join("\n");
  }

  #parseTaskChainRound(task: TaskItem) {
    const chainRound = task.chain_round;

    if (!isNumber(chainRound) || chainRound < 1) {
      return null;
    }

    return chainRound;
  }

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

  #getActiveSessionContext() {
    return this.#readSessionContext(this.#context.meta.sessionId);
  }

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

  public syncTask(task: TaskItem) {
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
      followUp.accumulatedAssistantOutput = "";
      followUp.lastAssistantOutput = "";
    }

    if (task.source === TaskSource.EXTERNAL) {
      followUp.originalUserInput = this.#convertTaskPayloadToPrompt(task);
      return;
    }

    if (hasChatChanged || hasSessionChanged) {
      followUp.originalUserInput = "";
    }
  }

  public createPromptContextSnapshot(): RuntimePromptContextSnapshot {
    const sessionContext = this.#getActiveSessionContext();

    return {
      sessionId: this.#context.meta.sessionId,
      round: this.#context.meta.round,
      source: this.#context.channel.source,
      followUp: this.#context.followUp
        ? structuredClone(this.#context.followUp)
        : undefined,
      conversation: structuredClone(sessionContext.conversation),
      memory: structuredClone(sessionContext.memory),
    };
  }

  public appendAssistantOutput(textDelta: string) {
    if (isEmpty(textDelta)) {
      return;
    }

    this.#getOrCreateFollowUpContext().accumulatedAssistantOutput += textDelta;
  }

  public setLastAssistantOutput(text: string) {
    this.#getOrCreateFollowUpContext().lastAssistantOutput = text;
  }

  public commitSessionTurn(userInput: string, assistantOutput: string) {
    const sessionContext = this.#getActiveSessionContext();

    sessionContext.conversation = {
      lastUserInput: userInput.trim(),
      lastAssistantOutput: assistantOutput.trim(),
      updatedAt: Date.now(),
    };
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
        options.reason?.trim() ||
        `No ${scope} memory matched ${options.words.trim()}`,
    });
  }

  public clearMemoryContext(scope?: MemoryScope) {
    const sessionContext = this.#getActiveSessionContext();

    if (scope) {
      sessionContext.memory[scope] = createRuntimeMemoryScopeContext();
      return;
    }

    sessionContext.memory = createRuntimeMemoryContext();
  }

  public getMemoryContext(scope: MemoryScope) {
    return structuredClone(this.#getActiveSessionContext().memory[scope]);
  }

  public getSessionMemorySnapshot() {
    return structuredClone(this.#getActiveSessionContext().memory);
  }

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

  public hasSessionHistory() {
    return this.#getActiveSessionContext().conversation.updatedAt !== null;
  }

  public getCurrentChainRound() {
    return this.#context.followUp?.chainRound ?? null;
  }

  public getLoadedMemoryScopeByKey(memoryKey: string): MemoryScope | null {
    for (const scope of MEMORY_SCOPES) {
      const memoryContext = this.#getActiveSessionContext().memory[scope];

      if (
        memoryContext.status === "loaded" &&
        memoryContext.output?.memory.key === memoryKey
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
