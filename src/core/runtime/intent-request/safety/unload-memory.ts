/**
 * intent-request/safety/unload-memory.ts
 * @description
 * 校验 UNLOAD_MEMORY 请求中的 memory key 是否在允许边界内。
 */
import type { RejectedIntentRequest, UnloadMemoryIntentRequest } from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import {
  createRejectedIntentRequest,
  MAX_MEMORY_KEY_LENGTH,
} from "./shared";

/* ==================== */
/* UNLOAD_MEMORY Safety */
/* ==================== */

export const checkUnloadMemoryIntentRequestSafety = (
  request: UnloadMemoryIntentRequest,
): RejectedIntentRequest | null => {
  if (request.params.key.length > MAX_MEMORY_KEY_LENGTH) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.MEMORY_KEY_TOO_LONG,
      `UNLOAD_MEMORY.key length cannot exceed ${MAX_MEMORY_KEY_LENGTH}`,
    );
  }

  return null;
};
