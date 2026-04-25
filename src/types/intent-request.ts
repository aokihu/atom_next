/**
 * Intent Request 与请求体类型
 * @description
 * 定义外部 API 请求进入系统时使用的数据结构。
 */

import type { UUID } from "./primitive";
import type { TaskChannel, TaskPayload } from "./task";

export type ChatSubmissionBody = {
  payload: TaskPayload;
  priority?: number;
  channel?: TaskChannel;
};

/**
 * Intent Request 种类
 * @description
 * 定义 Runtime 当前支持的内部请求类型。
 */
export enum IntentRequestType {
  PREPARE_CONVERSATION = "PREPARE_CONVERSATION",
  SEARCH_MEMORY = "SEARCH_MEMORY",
  LOAD_MEMORY = "LOAD_MEMORY",
  UNLOAD_MEMORY = "UNLOAD_MEMORY",
  SAVE_MEMORY = "SAVE_MEMORY",
  UPDATE_MEMORY = "UPDATE_MEMORY",
  LOAD_SKILL = "LOAD_SKILL",
  FOLLOW_UP = "FOLLOW_UP",
  FOLLOW_UP_WITH_TOOLS = "FOLLOW_UP_WITH_TOOLS",
}

/**
 * Intent Request 记忆范围
 * @description
 * 对记忆搜索和保存操作使用统一的范围标识。
 */
export enum IntentRequestMemoryScope {
  CORE = "core",
  SHORT = "short",
  LONG = "long",
}

export const INTENT_REQUEST_TYPES = Object.values(IntentRequestType);

export enum IntentRequestSource {
  PREDICTION = "prediction",
  CONVERSATION = "conversation",
}

export const INTENT_REQUEST_SOURCES = Object.values(IntentRequestSource);

export const INTENT_REQUEST_MEMORY_SCOPES = Object.values(
  IntentRequestMemoryScope,
);

export const INTENT_REQUEST_MEMORY_UNLOAD_REASONS = [
  "answer_completed",
  "memory_irrelevant",
  "memory_replaced",
  "memory_conflicted",
] as const;

export const isIntentRequestType = (
  value: string,
): value is IntentRequestType => {
  return INTENT_REQUEST_TYPES.includes(value as IntentRequestType);
};

export const isIntentRequestMemoryScope = (
  value: string,
): value is IntentRequestMemoryScope => {
  return INTENT_REQUEST_MEMORY_SCOPES.includes(
    value as IntentRequestMemoryScope,
  );
};

export type IntentRequestMemoryUnloadReason =
  (typeof INTENT_REQUEST_MEMORY_UNLOAD_REASONS)[number];

export const isIntentRequestMemoryUnloadReason = (
  value: string,
): value is IntentRequestMemoryUnloadReason => {
  return INTENT_REQUEST_MEMORY_UNLOAD_REASONS.includes(
    value as IntentRequestMemoryUnloadReason,
  );
};

type BaseIntentRequest<TRequest extends IntentRequestType, TParams> = {
  source: IntentRequestSource;
  request: TRequest;
  intent: string;
  params: TParams;
};

export const PREPARE_CONVERSATION_INTENT_TYPES = [
  "direct_answer",
  "memory_lookup",
  "memory_save",
  "follow_up",
  "mixed",
  "unknown",
] as const;

export const PREPARE_CONVERSATION_PROMPT_VARIANTS = [
  "default",
  "recall",
  "continuity",
  "strict",
] as const;

export const PREPARE_CONVERSATION_PREDICTION_TRUST = [
  "high",
  "medium",
  "low",
] as const;

export type PrepareConversationIntentType =
  (typeof PREPARE_CONVERSATION_INTENT_TYPES)[number];
export type PrepareConversationPromptVariant =
  (typeof PREPARE_CONVERSATION_PROMPT_VARIANTS)[number];
export type PrepareConversationPredictionTrust =
  (typeof PREPARE_CONVERSATION_PREDICTION_TRUST)[number];

export type PrepareConversationIntentRequestParams = {
  acceptedIntentType: PrepareConversationIntentType;
  preloadMemory: boolean;
  memoryQuery: string;
  allowMemorySave: boolean;
  maxFollowUpRounds: number;
  promptVariant: PrepareConversationPromptVariant;
  predictionTrust: PrepareConversationPredictionTrust;
  maxOutputTokens: number | null;
  requestTokenReserve: number | null;
  visibleOutputBudget: number | null;
  preferEarlyFollowUp: boolean;
  isNewChatInSession: boolean;
  responseStrategyText: string;
};

export type SearchMemoryIntentRequestParams = {
  words: string;
  limit?: number;
  scope?: IntentRequestMemoryScope;
};

export type LoadMemoryIntentRequestParams = {
  key: string;
};

export type UnloadMemoryIntentRequestParams = {
  key: string;
  reason: IntentRequestMemoryUnloadReason;
};

export type SaveMemoryIntentRequestParams = {
  text: string;
  summary?: string;
  scope?: IntentRequestMemoryScope;
};

export type UpdateMemoryIntentRequestParams = {
  key: string;
  text?: string;
  summary?: string;
};

export type LoadSkillIntentRequestParams = {
  skill: string;
};

export type FollowUpIntentRequestParams = {};

export type FollowUpWithToolsIntentRequestParams = {
  summary: string;
  nextPrompt: string;
  avoidRepeat?: string;
};

export type PrepareConversationIntentRequest = BaseIntentRequest<
  IntentRequestType.PREPARE_CONVERSATION,
  PrepareConversationIntentRequestParams
>;

export type SearchMemoryIntentRequest = BaseIntentRequest<
  IntentRequestType.SEARCH_MEMORY,
  SearchMemoryIntentRequestParams
>;

export type LoadMemoryIntentRequest = BaseIntentRequest<
  IntentRequestType.LOAD_MEMORY,
  LoadMemoryIntentRequestParams
>;

export type UnloadMemoryIntentRequest = BaseIntentRequest<
  IntentRequestType.UNLOAD_MEMORY,
  UnloadMemoryIntentRequestParams
>;

export type SaveMemoryIntentRequest = BaseIntentRequest<
  IntentRequestType.SAVE_MEMORY,
  SaveMemoryIntentRequestParams
>;

export type UpdateMemoryIntentRequest = BaseIntentRequest<
  IntentRequestType.UPDATE_MEMORY,
  UpdateMemoryIntentRequestParams
>;

export type LoadSkillIntentRequest = BaseIntentRequest<
  IntentRequestType.LOAD_SKILL,
  LoadSkillIntentRequestParams
>;

export type FollowUpIntentRequest = BaseIntentRequest<
  IntentRequestType.FOLLOW_UP,
  FollowUpIntentRequestParams
>;

export type FollowUpWithToolsIntentRequest = BaseIntentRequest<
  IntentRequestType.FOLLOW_UP_WITH_TOOLS,
  FollowUpWithToolsIntentRequestParams
>;

/**
 * Intent Request 数据结构
 * @description
 * Runtime 解析出的一条合法内部请求。
 */
export type IntentRequest =
  | PrepareConversationIntentRequest
  | SearchMemoryIntentRequest
  | LoadMemoryIntentRequest
  | UnloadMemoryIntentRequest
  | SaveMemoryIntentRequest
  | UpdateMemoryIntentRequest
  | LoadSkillIntentRequest
  | FollowUpIntentRequest
  | FollowUpWithToolsIntentRequest;

/**
 * Intent Request 安全检查上下文
 * @description
 * 安全检查需要绑定当前对话身份，避免请求跨会话滥用。
 */
export type IntentRequestSafetyContext = {
  sessionId: UUID;
  chatId: UUID;
};

/**
 * Intent Request 安全问题代码
 * @description
 * 用稳定的代码标识拒绝原因，便于后续审计和分发策略扩展。
 */
export enum IntentRequestSafetyIssueCode {
  MISSING_RUNTIME_CONTEXT = "missing_runtime_context",
  TOO_MANY_REQUESTS = "too_many_requests",
  INTENT_TOO_LONG = "intent_too_long",
  MEMORY_KEY_TOO_LONG = "memory_key_too_long",
  SEARCH_WORDS_TOO_LONG = "search_words_too_long",
  SEARCH_LIMIT_TOO_LARGE = "search_limit_too_large",
  MEMORY_CONTENT_TOO_LONG = "memory_content_too_long",
  SKILL_NAME_INVALID = "skill_name_invalid",
  FOLLOW_UP_WITH_TOOLS_SUMMARY_TOO_LONG = "follow_up_with_tools_summary_too_long",
  FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_TOO_LONG = "follow_up_with_tools_next_prompt_too_long",
  FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_TOO_LONG = "follow_up_with_tools_avoid_repeat_too_long",
  INVALID_REQUEST_SOURCE = "invalid_request_source",
}

export type RejectedIntentRequest = {
  request: IntentRequest;
  code: IntentRequestSafetyIssueCode;
  reason: string;
};

export type IntentRequestSafetyResult = {
  safeRequests: IntentRequest[];
  rejectedRequests: RejectedIntentRequest[];
};

/**
 * Intent Request 分发状态
 * @description
 * 当前阶段先把分发结果标准化，便于后续替换占位实现。
 */
export enum IntentRequestDispatchStatus {
  ACCEPTED = "accepted",
  UNIMPLEMENTED = "unimplemented",
}

export type IntentRequestDispatchResult = {
  request: IntentRequest;
  status: IntentRequestDispatchStatus;
  message: string;
};

export type IntentRequestHandleResult = {
  parsedRequests: IntentRequest[];
  safeRequests: IntentRequest[];
  rejectedRequests: RejectedIntentRequest[];
  dispatchResults: IntentRequestDispatchResult[];
};
