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
  IntentRequestSafetyContext,
  RejectedIntentRequest,
} from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import { createRejectedIntentRequest } from "./shared";

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
