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
