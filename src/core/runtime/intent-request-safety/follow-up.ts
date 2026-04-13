import type {
  FollowUpIntentRequest,
  IntentRequestSafetyContext,
  RejectedIntentRequest,
} from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import { createRejectedIntentRequest } from "./shared";

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
