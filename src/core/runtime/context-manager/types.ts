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
  UUID,
} from "@/types";
import type { TaskSource, TaskItem } from "@/types/task";
import type { RuntimeMemoryItem } from "../memory-item";

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
  continuation?: RuntimeContinuationContext;
  toolContext?: RuntimeToolContext;
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

export type RuntimeContinuationContext = {
  summary: string;
  nextPrompt: string;
  avoidRepeat: string;
  updatedAt: number | null;
};

export type RuntimeToolContextMode = "idle" | "active" | "finished" | "ended";

export type RuntimeToolActiveCall = {
  toolName: string;
  toolCallId: string;
  input: unknown;
  updatedAt: number | null;
};

export type RuntimeToolResultRecord = {
  key: string;
  toolName: string;
  toolCallId: string;
  input: unknown;
  result?: unknown;
  error?: string;
  ok: boolean;
  snapshotText?: string;
  createdAt: number;
  updatedAt: number;
};

export type RuntimeToolResultPromptView = {
  key: string;
  toolName: string;
  target: string;
  summary: string;
  outputSummary: string;
  outputDetail?: string;
  errorMessage: string;
  reusable: boolean;
};

export type RuntimeToolResultItem = {
  record: RuntimeToolResultRecord;
  promptView: RuntimeToolResultPromptView;
};

export type RuntimeToolContext = {
  mode: RuntimeToolContextMode;
  activeToolCall?: RuntimeToolActiveCall;
  results: RuntimeToolResultItem[];
  injectionOrder: string[];
  updatedAt: number | null;
};

export type RuntimeMemoryScopeStatus = "idle" | "loaded" | "empty";
export type RuntimeMemoryScopeKind = "search_result" | "topic_archive" | null;

export type RuntimeMemoryScopeContext = {
  status: RuntimeMemoryScopeStatus;
  query: string;
  reason: string;
  outputs: RuntimeMemoryItem[];
  kind: RuntimeMemoryScopeKind;
  archivedFromConversation: boolean;
  ttlTurnsRemaining: number | null;
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

export type SyncContinuationContextInput = {
  previousContinuation?: RuntimeContinuationContext;
  previousSessionId: UUID | EmptyString;
  previousChatId: UUID | EmptyString;
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
  continuation?: RuntimeContinuationContext;
  toolContext?: RuntimeToolContext;
  conversation: RuntimeConversationContext;
  memory: RuntimeMemoryContext;
};
