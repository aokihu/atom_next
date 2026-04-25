/**
 * intent-request/execution.ts
 * @description
 * 负责串行执行一组已经通过安全检查的 Intent Request。
 *
 * 这个文件只负责执行流程编排：
 * - 控制请求的串行消费顺序
 * - 处理中途 stop/continue
 * - 处理 repeated search 和 missing follow-up 这类跨请求状态
 *
 * 单个请求如何执行，交给 execution-handlers.ts。
 */
import type {
  IntentRequest,
  SearchMemoryIntentRequest,
} from "@/types";
import { IntentRequestType } from "@/types";
import type { TaskItem } from "@/types/task";
import {
  shouldSkipRepeatedSearchMemory,
} from "./execution-helpers";
import {
  processIntentRequest,
  processRepeatedSearchFollowUpIntentRequest,
  processSearchMemoryWithoutFollowUpIntentRequest,
} from "./execution-handlers";
import type {
  IntentRequestExecutionResult,
  RuntimeIntentRequestExecutionContext,
} from "./types";

/* ==================== */
/* Public Execution API */
/* ==================== */

const isFollowUpRequest = (request: IntentRequest) => {
  return request.request === IntentRequestType.FOLLOW_UP
    || request.request === IntentRequestType.FOLLOW_UP_WITH_TOOLS;
};

export const executeIntentRequests = async (
  task: TaskItem,
  requests: IntentRequest[],
  context: RuntimeIntentRequestExecutionContext,
) => {
  let repeatedSearchRequest: SearchMemoryIntentRequest | null = null;
  let lastSearchRequest: SearchMemoryIntentRequest | null = null;
  let hasFollowUpRequest = false;

  for (const request of requests) {
    if (
      request.request === IntentRequestType.SEARCH_MEMORY &&
      shouldSkipRepeatedSearchMemory(task, request, context)
    ) {
      repeatedSearchRequest = request;
      lastSearchRequest = request;
      continue;
    }

    if (repeatedSearchRequest && isFollowUpRequest(request)) {
      hasFollowUpRequest = true;
      return processRepeatedSearchFollowUpIntentRequest(
        task,
        repeatedSearchRequest,
        context,
      );
    }

    if (request.request === IntentRequestType.SEARCH_MEMORY) {
      lastSearchRequest = request;
    }

    if (isFollowUpRequest(request)) {
      hasFollowUpRequest = true;
    }

    const processResult = processIntentRequest(task, request, context);

    if (processResult.status === "stop") {
      return processResult;
    }
  }

  const pendingSearchRequest = repeatedSearchRequest ?? lastSearchRequest;

  if (pendingSearchRequest && !hasFollowUpRequest) {
    return processSearchMemoryWithoutFollowUpIntentRequest(
      task,
      pendingSearchRequest,
      context,
    );
  }

  return {
    status: "continue",
  } satisfies IntentRequestExecutionResult;
};
