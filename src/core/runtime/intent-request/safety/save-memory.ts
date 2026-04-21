/**
 * intent-request/safety/save-memory.ts
 * @description
 * 校验 SAVE_MEMORY 请求写入的正文长度是否在允许边界内。
 */
import type { SaveMemoryIntentRequest, RejectedIntentRequest } from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import {
  createRejectedIntentRequest,
  MAX_MEMORY_CONTENT_LENGTH,
} from "./shared";

/* ==================== */
/* SAVE_MEMORY Safety   */
/* ==================== */

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
