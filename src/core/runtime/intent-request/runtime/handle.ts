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
import type { Logger } from "@/libs/log";

/* ==================== */
/* Report Helpers       */
/* ==================== */

function reportIntentRequestParseMiss(
  intentRequestText: string,
  shouldReportLogs: boolean,
  logger?: Logger,
) {
  if (!shouldReportLogs || !logger) {
    return;
  }

  logger.warn("Intent Request parse miss", {
    data: {
      intentRequestText,
    },
  });
}

function reportRejectedIntentRequests(
  rejectedRequests: RejectedIntentRequest[],
  shouldReportLogs: boolean,
  logger?: Logger,
) {
  if (!shouldReportLogs || !logger) {
    return;
  }

  for (const rejectedRequest of rejectedRequests) {
    logger.warn("Intent Request rejected", {
      data: {
        request: rejectedRequest.request.request,
        reason: rejectedRequest.reason,
        code: rejectedRequest.code,
      },
    });
  }
}

function reportIntentRequestDispatchResults(
  dispatchResults: IntentRequestDispatchResult[],
  shouldReportLogs: boolean,
  logger?: Logger,
) {
  if (!shouldReportLogs || !logger) {
    return;
  }

  for (const dispatchResult of dispatchResults) {
    logger.info("Intent Request dispatched", {
      data: {
        request: dispatchResult.request.request,
        status: dispatchResult.status,
        message: dispatchResult.message,
      },
    });
  }
}

function reportHandledIntentRequests(
  input: {
    intentRequestText: string;
    parsedRequests: IntentRequest[];
    safeRequests: IntentRequest[];
    rejectedRequests: RejectedIntentRequest[];
    dispatchResults: IntentRequestDispatchResult[];
  },
  shouldReportLogs: boolean,
  logger?: Logger,
) {
  if (!shouldReportLogs || !logger || input.intentRequestText.trim() === "") {
    return;
  }

  logger.debugJson("Intent Request handled", {
    intentRequestText: input.intentRequestText,
    parsedRequests: input.parsedRequests,
    safeRequests: input.safeRequests,
    rejectedRequests: input.rejectedRequests,
    dispatchResults: input.dispatchResults,
  });
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
      input.logger,
    );
  }

  if (!input.safetyContext) {
    const result = createMissingRuntimeContextResult(parsedRequests);

    reportHandledIntentRequests(
      {
        intentRequestText: input.intentRequestText,
        parsedRequests: result.parsedRequests,
        safeRequests: result.safeRequests,
        rejectedRequests: result.rejectedRequests,
        dispatchResults: result.dispatchResults,
      },
      input.shouldReportLogs,
      input.logger,
    );

    return result;
  }

  const safetyResult = checkIntentRequestSafety(
    parsedRequests,
    input.safetyContext,
  );
  const dispatchResults = dispatchIntentRequests(safetyResult.safeRequests);

  reportRejectedIntentRequests(
    safetyResult.rejectedRequests,
    input.shouldReportLogs,
    input.logger,
  );
  reportIntentRequestDispatchResults(
    dispatchResults,
    input.shouldReportLogs,
    input.logger,
  );

  reportHandledIntentRequests(
    {
      intentRequestText: input.intentRequestText,
      parsedRequests,
      safeRequests: safetyResult.safeRequests,
      rejectedRequests: safetyResult.rejectedRequests,
      dispatchResults,
    },
    input.shouldReportLogs,
    input.logger,
  );

  return {
    parsedRequests,
    safeRequests: safetyResult.safeRequests,
    rejectedRequests: safetyResult.rejectedRequests,
    dispatchResults,
  };
};
