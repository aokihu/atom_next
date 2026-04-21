/**
 * intent-request/runtime/handle.ts
 * @description
 * 负责 Intent Request 在 Runtime 层的处理组合逻辑。
 *
 * 这个子域处理的是“Runtime 如何消费一段 intent request 文本”：
 * - 协议解析
 * - parse miss 可观测性
 * - safety context 缺失时的拒绝结果构造
 * - safety 校验
 * - dispatch 结果生成
 * - 受控日志输出
 *
 * 它不执行具体 request 动作，执行仍由 intent-request/execution 子域负责。
 */
import type {
  IntentRequest,
  IntentRequestDispatchResult,
  IntentRequestHandleResult,
  RejectedIntentRequest,
} from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import { dispatchIntentRequests } from "../dispatch";
import { parseIntentRequests } from "../parse";
import { checkIntentRequestSafety } from "../safety";
import type { HandleIntentRequestRuntime } from "./types";

/* ==================== */
/* Report Helpers       */
/* ==================== */

function reportIntentRequestParseMiss(
  intentRequestText: string,
  shouldReportLogs: boolean,
) {
  if (!shouldReportLogs) {
    return;
  }

  console.warn(
    "[Intent Request] parse miss, raw request text was ignored:\n%s",
    intentRequestText,
  );
}

function reportRejectedIntentRequests(
  rejectedRequests: RejectedIntentRequest[],
  shouldReportLogs: boolean,
) {
  if (!shouldReportLogs) {
    return;
  }

  for (const rejectedRequest of rejectedRequests) {
    console.warn(
      "[Intent Request] rejected %s: %s",
      rejectedRequest.request.request,
      rejectedRequest.reason,
    );
  }
}

function reportIntentRequestDispatchResults(
  dispatchResults: IntentRequestDispatchResult[],
  shouldReportLogs: boolean,
) {
  if (!shouldReportLogs) {
    return;
  }

  for (const dispatchResult of dispatchResults) {
    console.info(
      "[Intent Request] dispatched %s as %s: %s",
      dispatchResult.request.request,
      dispatchResult.status,
      dispatchResult.message,
    );
  }
}

/* ==================== */
/* Result Helpers       */
/* ==================== */

function createMissingRuntimeContextResult(
  parsedRequests: IntentRequest[],
): IntentRequestHandleResult {
  return {
    parsedRequests,
    safeRequests: [],
    rejectedRequests: parsedRequests.map((request) => {
      return {
        request,
        code: IntentRequestSafetyIssueCode.MISSING_RUNTIME_CONTEXT,
        reason:
          "Runtime currentTask is missing, cannot validate or dispatch intent request",
      };
    }),
    dispatchResults: [],
  };
}

/* ==================== */
/* Runtime Handle       */
/* ==================== */

export const handleIntentRequestRuntime: HandleIntentRequestRuntime = (
  input,
) => {
  const parsedRequests = parseIntentRequests(input.intentRequestText);

  if (input.intentRequestText.trim() !== "" && parsedRequests.length === 0) {
    reportIntentRequestParseMiss(
      input.intentRequestText,
      input.shouldReportLogs,
    );
  }

  if (!input.safetyContext) {
    return createMissingRuntimeContextResult(parsedRequests);
  }

  const safetyResult = checkIntentRequestSafety(
    parsedRequests,
    input.safetyContext,
  );
  const dispatchResults = dispatchIntentRequests(safetyResult.safeRequests);

  reportRejectedIntentRequests(
    safetyResult.rejectedRequests,
    input.shouldReportLogs,
  );
  reportIntentRequestDispatchResults(dispatchResults, input.shouldReportLogs);

  return {
    parsedRequests,
    safeRequests: safetyResult.safeRequests,
    rejectedRequests: safetyResult.rejectedRequests,
    dispatchResults,
  };
};
