/**
 * intent-request/safety/follow-up.ts
 * @description
 * 校验 FOLLOW_UP 请求的会话绑定是否合法。
 *
 * FOLLOW_UP 必须严格绑定当前 runtime 的 session/chat，
 * 防止模型把后续调度指向其他会话。
 */
import type {
  FollowUpIntentRequest,
  FollowUpWithToolsEndIntentRequest,
  FollowUpWithToolsFinishedIntentRequest,
  FollowUpWithToolsIntentRequest,
  RejectedIntentRequest,
} from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import {
  createRejectedIntentRequest,
  MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH,
  MAX_FOLLOW_UP_WITH_TOOLS_END_REASON_LENGTH,
  MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH,
  MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH,
} from "./shared";

/* ==================== */
/* FOLLOW_UP Safety     */
/* ==================== */

export const checkFollowUpIntentRequestSafety = (
  _request: FollowUpIntentRequest,
  _context?: unknown,
): RejectedIntentRequest | null => {
  return null;
};

export const checkFollowUpWithToolsIntentRequestSafety = (
  request: FollowUpWithToolsIntentRequest,
  _context?: unknown,
): RejectedIntentRequest | null => {
  if (request.params.summary.length > MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_SUMMARY_TOO_LONG,
      `FOLLOW_UP_WITH_TOOLS.summary length cannot exceed ${MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH}`,
    );
  }

  if (
    request.params.nextPrompt.length
      > MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH
  ) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_TOO_LONG,
      `FOLLOW_UP_WITH_TOOLS.nextPrompt length cannot exceed ${MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH}`,
    );
  }

  if (
    request.params.avoidRepeat &&
    request.params.avoidRepeat.length
      > MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH
  ) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_TOO_LONG,
      `FOLLOW_UP_WITH_TOOLS.avoidRepeat length cannot exceed ${MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH}`,
    );
  }

  return null;
};

export const checkFollowUpWithToolsFinishedIntentRequestSafety = (
  request: FollowUpWithToolsFinishedIntentRequest,
  context?: { hasActiveToolContext?: boolean },
): RejectedIntentRequest | null => {
  if (!context?.hasActiveToolContext) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.TOOL_CONTEXT_REQUIRED,
      "FOLLOW_UP_WITH_TOOLS_FINISHED requires active tool context",
    );
  }

  if (request.params.summary.length > MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_SUMMARY_TOO_LONG,
      `FOLLOW_UP_WITH_TOOLS_FINISHED.summary length cannot exceed ${MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH}`,
    );
  }

  if (
    request.params.nextPrompt &&
    request.params.nextPrompt.length
      > MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH
  ) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_TOO_LONG,
      `FOLLOW_UP_WITH_TOOLS_FINISHED.nextPrompt length cannot exceed ${MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH}`,
    );
  }

  if (
    request.params.avoidRepeat &&
    request.params.avoidRepeat.length
      > MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH
  ) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_TOO_LONG,
      `FOLLOW_UP_WITH_TOOLS_FINISHED.avoidRepeat length cannot exceed ${MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH}`,
    );
  }

  return null;
};

export const checkFollowUpWithToolsEndIntentRequestSafety = (
  request: FollowUpWithToolsEndIntentRequest,
  context?: { hasActiveToolContext?: boolean },
): RejectedIntentRequest | null => {
  if (!context?.hasActiveToolContext) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.TOOL_CONTEXT_REQUIRED,
      "FOLLOW_UP_WITH_TOOLS_END requires active tool context",
    );
  }

  if (request.params.reason.length > MAX_FOLLOW_UP_WITH_TOOLS_END_REASON_LENGTH) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.FOLLOW_UP_WITH_TOOLS_END_REASON_TOO_LONG,
      `FOLLOW_UP_WITH_TOOLS_END.reason length cannot exceed ${MAX_FOLLOW_UP_WITH_TOOLS_END_REASON_LENGTH}`,
    );
  }

  return null;
};
