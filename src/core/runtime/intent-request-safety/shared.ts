import type { IntentRequest, RejectedIntentRequest } from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";

export const MAX_INTENT_REQUEST_COUNT = 5;
export const MAX_INTENT_TEXT_LENGTH = 200;
export const MAX_SEARCH_WORDS_LENGTH = 200;
export const MAX_SEARCH_LIMIT = 20;
export const MAX_MEMORY_KEY_LENGTH = 200;
export const MAX_MEMORY_CONTENT_LENGTH = 1000;
export const MAX_SKILL_NAME_LENGTH = 120;
export const SKILL_NAME_PATTERN = /^[A-Za-z0-9:_/-]+$/;

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
