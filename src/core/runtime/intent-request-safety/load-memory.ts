import type { LoadMemoryIntentRequest, RejectedIntentRequest } from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import {
  createRejectedIntentRequest,
  MAX_MEMORY_KEY_LENGTH,
} from "./shared";

export const checkLoadMemoryIntentRequestSafety = (
  request: LoadMemoryIntentRequest,
): RejectedIntentRequest | null => {
  if (request.params.key.length > MAX_MEMORY_KEY_LENGTH) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.MEMORY_KEY_TOO_LONG,
      `LOAD_MEMORY.key length cannot exceed ${MAX_MEMORY_KEY_LENGTH}`,
    );
  }

  return null;
};
