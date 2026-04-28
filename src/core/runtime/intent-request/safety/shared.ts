/**
 * intent-request/safety/shared.ts
 * @description
 * 收口 Intent Request 安全检查阶段共用的常量和基础工具。
 *
 * 这个文件只定义共享边界：
 * - 长度上限
 * - 通用 rejected request 构造
 * - 所有请求都要经过的基础校验
 */
import type { IntentRequest, RejectedIntentRequest } from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";

/* ==================== */
/* Safety Limits        */
/* ==================== */

export const MAX_INTENT_REQUEST_COUNT = 5;
export const MAX_INTENT_TEXT_LENGTH = 200;
export const MAX_SEARCH_WORDS_LENGTH = 200;
export const MAX_SEARCH_LIMIT = 20;
export const MAX_MEMORY_KEY_LENGTH = 200;
export const MAX_MEMORY_CONTENT_LENGTH = 1000;
export const MAX_SKILL_NAME_LENGTH = 120;
export const MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH = 1000;
export const MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH = 1000;
export const MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH = 500;
export const MAX_FOLLOW_UP_WITH_TOOLS_END_REASON_LENGTH = 500;
export const SKILL_NAME_PATTERN = /^[A-Za-z0-9:_/-]+$/;

/* ==================== */
/* Shared Helpers       */
/* ==================== */

export const createRejectedIntentRequest = (
  request: IntentRequest,
  code: IntentRequestSafetyIssueCode,
  reason: string,
): RejectedIntentRequest => {
  return {
    request,
    code,
    reason,
  };
};

/* ==================== */
/* Base Safety          */
/* ==================== */

export const checkIntentRequestBaseSafety = (
  request: IntentRequest,
): RejectedIntentRequest | null => {
  if (request.intent.length > MAX_INTENT_TEXT_LENGTH) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.INTENT_TOO_LONG,
      `Intent text length cannot exceed ${MAX_INTENT_TEXT_LENGTH}`,
    );
  }

  return null;
};
