/**
 * HandleToolBoundary — decides whether pending tool calls need execution.
 *
 * If the transport result has pending tool calls, executes them.
 * Success → enqueue (follow_up continuation). Failure → complete (error message).
 * If no pending tool calls → passes through to intent_requests stage.
 */
import type { PipelineElement } from "@/core/pipeline";
import type { FormalConversationFlowState } from "../types";
import type { FormalConversationConversationOutput } from "../types";

const shouldExecutePendingToolCalls = (
  input: FormalConversationConversationOutput,
) => {
  return (
    input.transportResult.finishReason === "tool-calls"
    && (input.transportResult.pendingToolCalls?.length ?? 0) > 0
  );
};

const buildToolExecutionFailureMessage = (reason: string) => {
  return reason.trim() === ""
    ? "工具调用失败，暂时无法继续分析当前工作区。"
    : `工具调用失败，暂时无法继续分析当前工作区。错误：${reason}`;
};

export const handleToolBoundaryElement: PipelineElement<
  FormalConversationFlowState,
  FormalConversationFlowState
> = {
  name: "HandleToolBoundary",
  kind: "boundary",
  async process(input) {
    if (input.mode !== "conversation_output") {
      return input;
    }

    const output = input.output;

    if (!shouldExecutePendingToolCalls(output)) {
      return input;
    }

    const toolExecutionResult = await output.context.executeConversationToolCalls(
      output.transportResult.pendingToolCalls ?? [],
    );

    if (!toolExecutionResult.ok) {
      const visibleTextBuffer = buildToolExecutionFailureMessage(
        toolExecutionResult.reason ?? "",
      );

      return {
        mode: "ready_to_finalize",
        finalization: {
          type: "complete",
          context: output.context,
          transportResult: {
            ...output.transportResult,
            text: visibleTextBuffer,
          },
          visibleTextBuffer,
          hasStreamedVisibleOutput: false,
        },
      };
    }

    return {
      mode: "ready_to_finalize",
      finalization: {
        type: "enqueue",
        transition: "follow_up",
        context: output.context,
        transportResult: output.transportResult,
        visibleTextBuffer: output.state.visibleTextBuffer,
        hasStreamedVisibleOutput: output.state.hasStreamedVisibleOutput,
        nextTask: output.context.createContinuationFormalConversationTask(),
      },
    };
  },
};
