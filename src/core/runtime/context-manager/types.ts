/**
 * context-manager/types.ts
 * @description
 * 统一定义 ContextManager 子域使用的状态类型。
 *
 * 这个文件只负责类型声明，不放状态读写逻辑，也不放状态迁移规则。
 * 目的就是让调用方一眼知道：
 * - ContextManager 内部到底持有哪些状态
 * - prompt snapshot / follow-up / memory / session 这些对象各自长什么样
 */
import type {
  EmptyString,
  MemoryScope,
  RuntimeMemoryOutput,
  UUID,
} from "@/types";
import type { TaskSource, TaskItem } from "@/types/task";

/* ==================== */
/* Core Context Types   */
/* ==================== */

export type RuntimeContext = {
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

export type RuntimeMemoryContext = Record<MemoryScope, RuntimeMemoryScopeContext>;

export type RuntimeSessionContext = {
  memory: RuntimeMemoryContext;
  conversation: RuntimeConversationContext;
};

/* ==================== */
/* Runtime Policies     */
/* ==================== */

export type SessionMemoryClearPolicy =
  | "manual"
  | "topic_change"
  | "session_reset"
  | "lifecycle";

/* ==================== */
/* Sync Result Types    */
/* ==================== */

export type RuntimeTaskSession = {
  sessionId: UUID;
  chatId: UUID;
  round: number;
};

export type SyncTaskSessionResult = {
  round: number;
  taskSessions: RuntimeTaskSession[];
};

export type SyncFollowUpContextInput = {
  previousFollowUp?: RuntimeFollowUpContext;
  previousSessionId: UUID | EmptyString;
  task: TaskItem;
};

/* ==================== */
/* Prompt Snapshot      */
/* ==================== */

export type RuntimePromptContextSnapshot = {
  sessionId: UUID | EmptyString;
  round: number;
  source: TaskSource;
  followUp?: RuntimeFollowUpContext;
  conversation: RuntimeConversationContext;
  memory: RuntimeMemoryContext;
};
