import type { RejectedIntentRequest, UpdateMemoryIntentRequest } from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import {
  createRejectedIntentRequest,
  MAX_MEMORY_CONTENT_LENGTH,
  MAX_MEMORY_KEY_LENGTH,
} from "./shared";

export const checkUpdateMemoryIntentRequestSafety = (
  request: UpdateMemoryIntentRequest,
): RejectedIntentRequest | null => {
  if (request.params.key.length > MAX_MEMORY_KEY_LENGTH) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.MEMORY_KEY_TOO_LONG,
      `UPDATE_MEMORY.key length cannot exceed ${MAX_MEMORY_KEY_LENGTH}`,
    );
  }

  if (
    request.params.text
    && request.params.text.length > MAX_MEMORY_CONTENT_LENGTH
  ) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.MEMORY_CONTENT_TOO_LONG,
      `UPDATE_MEMORY.text length cannot exceed ${MAX_MEMORY_CONTENT_LENGTH}`,
    );
  }

  return null;
};
