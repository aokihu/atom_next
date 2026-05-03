import type { PipelineElement } from "@/core/pipeline";
import type { FormalConversationFlowState } from "../types";

const buildToolFailureVisibleMessage = (messages: string[]) => {
  const [firstMessage] = messages;
  return firstMessage
    ? `工具调用失败，暂时无法继续分析当前工作区。错误：${firstMessage}`
    : "工具调用失败，暂时无法继续分析当前工作区。";
};

const buildToolBoundaryVisibleMessage = (
  input: Extract<FormalConversationFlowState, { mode: "intent_requests" }>,
) => {
  if (input.output.state.toolFailureMessages.length > 0) {
    return buildToolFailureVisibleMessage(input.output.state.toolFailureMessages);
  }

  if (input.output.transportResult.toolCallCount === 0) {
    return "模型进入了工具调用阶段，但没有实际执行任何工具。请调整问题范围，或让我先检查更具体的文件或目录。";
  }

  if (input.output.transportResult.toolResultCount === 0) {
    return "工具调用已开始，但没有返回可用结果，当前分析已停止。请调整问题范围，或让我先检查更具体的文件或目录。";
  }

  return "工具调用已完成，但在当前多步调用内仍未形成最终结果。请缩小分析范围，或指定更具体的文件或目录。";
};

const shouldFinalizeToolCallBoundary = (
  input: Extract<FormalConversationFlowState, { mode: "intent_requests" }>,
) => {
  return (
    input.output.transportResult.finishReason === "tool-calls"
    && input.output.transportResult.intentRequestText.trim() === ""
    && input.requestExecutionResult?.status === "continue"
  );
};

export const applyIntentRequestExecutionElement: PipelineElement<
  FormalConversationFlowState,
  FormalConversationFlowState
> = {
  name: "ApplyIntentRequestExecution",
  kind: "boundary",
  async process(input) {
    if (input.mode === "ready_to_finalize") {
      return input;
    }

    if (!input.requestExecutionResult) {
      throw new Error("Intent request execution result is missing before apply");
    }

    if (shouldFinalizeToolCallBoundary(input)) {
      const visibleTextBuffer = buildToolBoundaryVisibleMessage(input);

      return {
        mode: "ready_to_finalize",
        finalization: {
          env: input.output.env,
          transportResult: {
            ...input.output.transportResult,
            text: visibleTextBuffer,
          },
          visibleTextBuffer,
          hasStreamedVisibleOutput: false,
          shouldComplete: true,
        },
      };
    }

    if (input.requestExecutionResult.status === "continue") {
      return {
        mode: "ready_to_finalize",
        finalization: {
          env: input.output.env,
          transportResult: input.output.transportResult,
          visibleTextBuffer: input.output.state.visibleTextBuffer,
          hasStreamedVisibleOutput: input.output.state.hasStreamedVisibleOutput,
          shouldComplete: true,
        },
      };
    }

    if (input.requestExecutionResult.nextState) {
      input.output.env.taskQueue.updateTask(
        input.output.env.task.id,
        { state: input.requestExecutionResult.nextState },
        { shouldSyncEvent: false },
      );
    }

    return {
      mode: "ready_to_finalize",
      finalization: {
        env: input.output.env,
        transportResult: input.output.transportResult,
        visibleTextBuffer: input.output.state.visibleTextBuffer,
        hasStreamedVisibleOutput: input.output.state.hasStreamedVisibleOutput,
        shouldComplete: false,
        nextTask: input.requestExecutionResult.nextTask,
      },
    };
  },
};
