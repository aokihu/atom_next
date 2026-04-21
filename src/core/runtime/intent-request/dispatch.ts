/**
 * intent-request/dispatch.ts
 * @description
 * 负责把安全通过的 Intent Request 映射成标准化分发结果。
 *
 * 这个文件只产出“请求是否被 Core 接受处理”的结果描述，
 * 不直接执行实际动作。
 */
import type {
  FollowUpIntentRequest,
  IntentRequest,
  IntentRequestDispatchResult,
  LoadMemoryIntentRequest,
  LoadSkillIntentRequest,
  PrepareConversationIntentRequest,
  SaveMemoryIntentRequest,
  SearchMemoryIntentRequest,
  UnloadMemoryIntentRequest,
  UpdateMemoryIntentRequest,
} from "@/types";
import {
  IntentRequestDispatchStatus,
  IntentRequestType,
} from "@/types";

/* ==================== */
/* Dispatch Result      */
/* ==================== */

const createUnimplementedDispatchResult = (
  request: IntentRequest,
  message: string,
): IntentRequestDispatchResult => {
  return {
    request,
    status: IntentRequestDispatchStatus.UNIMPLEMENTED,
    message,
  };
};

const createAcceptedDispatchResult = (
  request: IntentRequest,
  message: string,
): IntentRequestDispatchResult => {
  return {
    request,
    status: IntentRequestDispatchStatus.ACCEPTED,
    message,
  };
};

/* ==================== */
/* Typed Dispatch       */
/* ==================== */

const dispatchSearchMemoryIntentRequest = (
  request: SearchMemoryIntentRequest,
) => {
  return createAcceptedDispatchResult(
    request,
    "SEARCH_MEMORY request accepted and will be executed by Core before follow up scheduling",
  );
};

const dispatchPrepareConversationIntentRequest = (
  request: PrepareConversationIntentRequest,
) => {
  return createAcceptedDispatchResult(
    request,
    "PREPARE_CONVERSATION request accepted and will be executed by Core before formal conversation scheduling",
  );
};

const dispatchLoadMemoryIntentRequest = (
  request: LoadMemoryIntentRequest,
) => {
  return createAcceptedDispatchResult(
    request,
    "LOAD_MEMORY request accepted and will be executed by Core before follow up scheduling",
  );
};

const dispatchUnloadMemoryIntentRequest = (
  request: UnloadMemoryIntentRequest,
) => {
  return createAcceptedDispatchResult(
    request,
    "UNLOAD_MEMORY request accepted and will be executed by Core after current output finishes",
  );
};

const dispatchSaveMemoryIntentRequest = (
  request: SaveMemoryIntentRequest,
) => {
  return createAcceptedDispatchResult(
    request,
    "SAVE_MEMORY request accepted and will be executed by Core after current output finishes",
  );
};

const dispatchUpdateMemoryIntentRequest = (
  request: UpdateMemoryIntentRequest,
) => {
  return createAcceptedDispatchResult(
    request,
    "UPDATE_MEMORY request accepted and will be executed by Core after current output finishes",
  );
};

const dispatchLoadSkillIntentRequest = (
  request: LoadSkillIntentRequest,
) => {
  return createUnimplementedDispatchResult(
    request,
    "LOAD_SKILL dispatch is reserved but not implemented yet",
  );
};

const dispatchFollowUpIntentRequest = (
  request: FollowUpIntentRequest,
) => {
  return {
    request,
    status: IntentRequestDispatchStatus.ACCEPTED,
    message:
      "FOLLOW_UP request accepted and will be scheduled by Core when current output finishes",
  };
};

/* ==================== */
/* Public Dispatch API  */
/* ==================== */

/**
 * 分发安全通过的 Intent Request。
 * @description
 * 当前阶段负责标准化分发结果；
 * 真实动作由 Core 串行消费 safeRequests 后执行。
 */
export const dispatchIntentRequests = (
  requests: IntentRequest[],
): IntentRequestDispatchResult[] => {
  return requests.map((request) => {
    switch (request.request) {
      case IntentRequestType.PREPARE_CONVERSATION:
        return dispatchPrepareConversationIntentRequest(request);
      case IntentRequestType.SEARCH_MEMORY:
        return dispatchSearchMemoryIntentRequest(request);
      case IntentRequestType.LOAD_MEMORY:
        return dispatchLoadMemoryIntentRequest(request);
      case IntentRequestType.UNLOAD_MEMORY:
        return dispatchUnloadMemoryIntentRequest(request);
      case IntentRequestType.SAVE_MEMORY:
        return dispatchSaveMemoryIntentRequest(request);
      case IntentRequestType.UPDATE_MEMORY:
        return dispatchUpdateMemoryIntentRequest(request);
      case IntentRequestType.LOAD_SKILL:
        return dispatchLoadSkillIntentRequest(request);
      case IntentRequestType.FOLLOW_UP:
        return dispatchFollowUpIntentRequest(request);
    }
  });
};
