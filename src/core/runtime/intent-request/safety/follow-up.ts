/**
 * intent-request/safety/follow-up.ts
 * @description
 * 校验 FOLLOW_UP 请求的会话绑定是否合法。
 *
 * FOLLOW_UP 必须严格绑定当前 runtime 的 session/chat，
 * 防止模型把后续调度指向其他会话。
 */
import type {
  FollowUpIntentRequest,
  FollowUpWithToolsIntentRequest,
  IntentRequestSafetyContext,
  RejectedIntentRequest,
} from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import {
  createRejectedIntentRequest,
  MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH,
  MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH,
  MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH,
} from "./shared";

/* ==================== */
/* FOLLOW_UP Safety     */
/* ==================== */

export const checkFollowUpIntentRequestSafety = (
  request: FollowUpIntentRequest,
  context: IntentRequestSafetyContext,
): RejectedIntentRequest | null => {
  if (request.params.sessionId !== context.sessionId) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_SESSION_MISMATCH,
      "FOLLOW_UP.sessionId must match current runtime session",
    );
  }

  if (request.params.chatId !== context.chatId) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_CHAT_MISMATCH,
      "FOLLOW_UP.chatId must match current runtime chat",
    );
  }

  return null;
};

export const checkFollowUpWithToolsIntentRequestSafety = (
  request: FollowUpWithToolsIntentRequest,
  context: IntentRequestSafetyContext,
): RejectedIntentRequest | null => {
  if (request.params.sessionId !== context.sessionId) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_SESSION_MISMATCH,
      "FOLLOW_UP_WITH_TOOLS.sessionId must match current runtime session",
    );
  }

  if (request.params.chatId !== context.chatId) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_CHAT_MISMATCH,
      "FOLLOW_UP_WITH_TOOLS.chatId must match current runtime chat",
    );
  }

  if (request.params.summary.length > MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_SUMMARY_TOO_LONG,
      `FOLLOW_UP_WITH_TOOLS.summary length cannot exceed ${MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH}`,
    );
  }

  if (
    request.params.nextPrompt.length
      > MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH
  ) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_TOO_LONG,
      `FOLLOW_UP_WITH_TOOLS.nextPrompt length cannot exceed ${MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH}`,
    );
  }

  if (
    request.params.avoidRepeat &&
    request.params.avoidRepeat.length
      > MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH
  ) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_TOO_LONG,
      `FOLLOW_UP_WITH_TOOLS.avoidRepeat length cannot exceed ${MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH}`,
    );
  }

  return null;
};
