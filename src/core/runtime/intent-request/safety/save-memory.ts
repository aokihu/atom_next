import type { SaveMemoryIntentRequest, RejectedIntentRequest } from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import {
  createRejectedIntentRequest,
  MAX_MEMORY_CONTENT_LENGTH,
} from "./shared";

export const checkSaveMemoryIntentRequestSafety = (
  request: SaveMemoryIntentRequest,
): RejectedIntentRequest | null => {
  if (request.params.text.length > MAX_MEMORY_CONTENT_LENGTH) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.MEMORY_CONTENT_TOO_LONG,
      `SAVE_MEMORY.text length cannot exceed ${MAX_MEMORY_CONTENT_LENGTH}`,
    );
  }

  return null;
};
