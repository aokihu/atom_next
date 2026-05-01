import type {
  AppliedIntentRequests,
  ExecutedIntentRequests,
  FormalConversationTransportOutput,
  ToolBoundaryResolution,
} from "../types";
import { buildToolFailureVisibleMessage } from "./tool-errors";

export const shouldFinalizeToolCallBoundary = (
  input: ExecutedIntentRequests,
) => {
  return (
    input.transportResult.finishReason === "tool-calls"
    && input.transportResult.intentRequestText.trim() === ""
    && input.requestExecutionResult.status === "continue"
  );
};

const buildToolBoundaryVisibleMessage = (input: ExecutedIntentRequests) => {
  if (input.toolFailureMessages.length > 0) {
    return buildToolFailureVisibleMessage(input.toolFailureMessages);
  }

  if (input.transportResult.toolCallCount === 0) {
    return "模型进入了工具调用阶段，但没有实际执行任何工具。请调整问题范围，或让我先检查更具体的文件或目录。";
  }

  if (input.transportResult.toolResultCount === 0) {
    return "工具调用已开始，但没有返回可用结果，当前分析已停止。请调整问题范围，或让我先检查更具体的文件或目录。";
  }

  return "工具调用已完成，但在当前多步调用内仍未形成最终结果。请缩小分析范围，或指定更具体的文件或目录。";
};

export const buildToolLoopTerminationResult = (
  input: ExecutedIntentRequests,
): AppliedIntentRequests => {
  const visibleTextBuffer = buildToolBoundaryVisibleMessage(input);

  return {
    env: input.env,
    transportResult: {
      ...input.transportResult,
      text: visibleTextBuffer,
    },
    visibleTextBuffer,
    hasStreamedVisibleOutput: false,
    decision: { type: "finalize_chat" },
  };
};

export const shouldExecutePendingToolCalls = (
  input: FormalConversationTransportOutput,
) => {
  return (
    input.transportResult.finishReason === "tool-calls"
    && (input.transportResult.pendingToolCalls?.length ?? 0) > 0
  );
};

export const buildToolExecutionFailureResult = (
  input: FormalConversationTransportOutput,
  reason: string | undefined,
): AppliedIntentRequests => {
  const visibleTextBuffer = !reason || reason.trim() === ""
    ? "工具调用失败，暂时无法继续分析当前工作区。"
    : `工具调用失败，暂时无法继续分析当前工作区。错误：${reason}`;

  return {
    env: input.env,
    transportResult: {
      ...input.transportResult,
      text: visibleTextBuffer,
    },
    visibleTextBuffer,
    hasStreamedVisibleOutput: false,
    decision: { type: "finalize_chat" },
  };
};

export const continueToIntentRequests = (
  output: FormalConversationTransportOutput,
): ToolBoundaryResolution => {
  return {
    type: "continue_to_intent_requests",
    output,
  };
};

export const resolveToolBoundary = (
  applied: AppliedIntentRequests,
): ToolBoundaryResolution => {
  return {
    type: "resolved",
    applied,
  };
};
