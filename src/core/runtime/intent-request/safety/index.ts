/**
 * intent-request/safety/index.ts
 * @description
 * 负责对结构合法的 Intent Request 做安全边界校验。
 *
 * 这个文件只决定“请求是否允许进入执行阶段”，
 * 不负责协议解析，也不负责执行动作。
 */
import type {
  IntentRequest,
  IntentRequestSafetyContext,
  IntentRequestSafetyResult,
} from "@/types";
import {
  IntentRequestSafetyIssueCode,
  IntentRequestSource,
  IntentRequestType,
} from "@/types";
import {
  checkFollowUpIntentRequestSafety,
  checkFollowUpWithToolsIntentRequestSafety,
} from "./follow-up";
import { checkLoadMemoryIntentRequestSafety } from "./load-memory";
import { checkLoadSkillIntentRequestSafety } from "./load-skill";
import { checkSaveMemoryIntentRequestSafety } from "./save-memory";
import { checkSearchMemoryIntentRequestSafety } from "./search-memory";
import { checkUnloadMemoryIntentRequestSafety } from "./unload-memory";
import { checkUpdateMemoryIntentRequestSafety } from "./update-memory";
import {
  checkIntentRequestBaseSafety,
  createRejectedIntentRequest,
  MAX_INTENT_REQUEST_COUNT,
} from "./shared";

/* ==================== */
/* Safety Router        */
/* ==================== */

const checkSingleIntentRequestSafety = (
  request: IntentRequest,
  context: IntentRequestSafetyContext,
) => {
  const baseRejectedRequest = checkIntentRequestBaseSafety(request);

  if (baseRejectedRequest) {
    return baseRejectedRequest;
  }

  switch (request.request) {
    case IntentRequestType.PREPARE_CONVERSATION:
      return request.source === IntentRequestSource.PREDICTION
        ? undefined
        : createRejectedIntentRequest(
            request,
            IntentRequestSafetyIssueCode.INVALID_REQUEST_SOURCE,
            "PREPARE_CONVERSATION must come from prediction workflow",
          );
    case IntentRequestType.SEARCH_MEMORY:
      return checkSearchMemoryIntentRequestSafety(request);
    case IntentRequestType.LOAD_MEMORY:
      return checkLoadMemoryIntentRequestSafety(request);
    case IntentRequestType.UNLOAD_MEMORY:
      return checkUnloadMemoryIntentRequestSafety(request);
    case IntentRequestType.SAVE_MEMORY:
      return checkSaveMemoryIntentRequestSafety(request);
    case IntentRequestType.UPDATE_MEMORY:
      return checkUpdateMemoryIntentRequestSafety(request);
    case IntentRequestType.LOAD_SKILL:
      return checkLoadSkillIntentRequestSafety(request);
    case IntentRequestType.FOLLOW_UP:
      return checkFollowUpIntentRequestSafety(request, context);
    case IntentRequestType.FOLLOW_UP_WITH_TOOLS:
      return checkFollowUpWithToolsIntentRequestSafety(request, context);
  }
};

/**
 * 对合法结构的 Intent Request 做安全检查。
 * @description
 * 这里只做安全边界校验，不负责执行具体动作。
 */
export const checkIntentRequestSafety = (
  requests: IntentRequest[],
  context: IntentRequestSafetyContext,
): IntentRequestSafetyResult => {
  const safeRequests: IntentRequest[] = [];
  const rejectedRequests = [];

  for (const [index, request] of requests.entries()) {
    if (index >= MAX_INTENT_REQUEST_COUNT) {
      rejectedRequests.push(
        createRejectedIntentRequest(
          request,
          IntentRequestSafetyIssueCode.TOO_MANY_REQUESTS,
          `Only ${MAX_INTENT_REQUEST_COUNT} intent requests are allowed in one response`,
        ),
      );
      continue;
    }

    const rejectedRequest = checkSingleIntentRequestSafety(request, context);

    if (rejectedRequest) {
      rejectedRequests.push(rejectedRequest);
      continue;
    }

    safeRequests.push(request);
  }

  return {
    safeRequests,
    rejectedRequests,
  };
};
