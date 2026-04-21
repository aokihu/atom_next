/**
 * intent-request/safety/search-memory.ts
 * @description
 * 校验 SEARCH_MEMORY 请求的查询文本和搜索范围是否在允许边界内。
 */
import type { SearchMemoryIntentRequest, RejectedIntentRequest } from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import { isNumber } from "radashi";
import {
  createRejectedIntentRequest,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_WORDS_LENGTH,
} from "./shared";

/* ==================== */
/* SEARCH_MEMORY Safety */
/* ==================== */

export const checkSearchMemoryIntentRequestSafety = (
  request: SearchMemoryIntentRequest,
): RejectedIntentRequest | null => {
  if (request.params.words.length > MAX_SEARCH_WORDS_LENGTH) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.SEARCH_WORDS_TOO_LONG,
      `SEARCH_MEMORY.words length cannot exceed ${MAX_SEARCH_WORDS_LENGTH}`,
    );
  }

  if (isNumber(request.params.limit) && request.params.limit > MAX_SEARCH_LIMIT) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.SEARCH_LIMIT_TOO_LARGE,
      `SEARCH_MEMORY.limit cannot exceed ${MAX_SEARCH_LIMIT}`,
    );
  }

  return null;
};
