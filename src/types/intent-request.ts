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
  SEARCH_MEMORY = "SEARCH_MEMORY",
  SAVE_MEMORY = "SAVE_MEMORY",
  LOAD_SKILL = "LOAD_SKILL",
  FOLLOW_UP = "FOLLOW_UP",
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

export const INTENT_REQUEST_MEMORY_SCOPES = Object.values(
  IntentRequestMemoryScope,
);

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

type BaseIntentRequest<TRequest extends IntentRequestType, TParams> = {
  request: TRequest;
  intent: string;
  params: TParams;
};

export type SearchMemoryIntentRequestParams = {
  words: string;
  limit?: number;
  scope?: IntentRequestMemoryScope;
};

export type SaveMemoryIntentRequestParams = {
  content: string;
  scope?: IntentRequestMemoryScope;
};

export type LoadSkillIntentRequestParams = {
  skill: string;
};

export type FollowUpIntentRequestParams = {
  sessionId: UUID;
  chatId: UUID;
};

export type SearchMemoryIntentRequest = BaseIntentRequest<
  IntentRequestType.SEARCH_MEMORY,
  SearchMemoryIntentRequestParams
>;

export type SaveMemoryIntentRequest = BaseIntentRequest<
  IntentRequestType.SAVE_MEMORY,
  SaveMemoryIntentRequestParams
>;

export type LoadSkillIntentRequest = BaseIntentRequest<
  IntentRequestType.LOAD_SKILL,
  LoadSkillIntentRequestParams
>;

export type FollowUpIntentRequest = BaseIntentRequest<
  IntentRequestType.FOLLOW_UP,
  FollowUpIntentRequestParams
>;

/**
 * Intent Request 数据结构
 * @description
 * Runtime 解析出的一条合法内部请求。
 */
export type IntentRequest =
  | SearchMemoryIntentRequest
  | SaveMemoryIntentRequest
  | LoadSkillIntentRequest
  | FollowUpIntentRequest;

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
  SEARCH_WORDS_TOO_LONG = "search_words_too_long",
  SEARCH_LIMIT_TOO_LARGE = "search_limit_too_large",
  MEMORY_CONTENT_TOO_LONG = "memory_content_too_long",
  SKILL_NAME_INVALID = "skill_name_invalid",
  FOLLOW_UP_SESSION_MISMATCH = "follow_up_session_mismatch",
  FOLLOW_UP_CHAT_MISMATCH = "follow_up_chat_mismatch",
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
