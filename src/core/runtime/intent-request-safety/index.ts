import type {
  IntentRequest,
  IntentRequestSafetyContext,
  IntentRequestSafetyResult,
} from "@/types";
import { IntentRequestSafetyIssueCode, IntentRequestType } from "@/types";
import { checkFollowUpIntentRequestSafety } from "./follow-up";
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

const checkSingleIntentRequestSafety = (
  request: IntentRequest,
  context: IntentRequestSafetyContext,
) => {
  const baseRejectedRequest = checkIntentRequestBaseSafety(request);

  if (baseRejectedRequest) {
    return baseRejectedRequest;
  }

  switch (request.request) {
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
