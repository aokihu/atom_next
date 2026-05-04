import type { PipelineElement, PipelineEnqueueTransition } from "@/core/pipeline";
import type { FormalConversationFlowState } from "../types";

const buildToolFailureVisibleMessage = (messages: string[]) => {
  const [firstMessage] = messages;
  return firstMessage
    ? `工具调用失败，暂时无法继续分析当前工作区。错误：${firstMessage}`
    : "工具调用失败，暂时无法继续分析当前工作区。";
};

const buildToolBoundaryVisibleMessage = (
  output: { state: { toolFailureMessages: string[]; }; transportResult: { toolCallCount: number; toolResultCount: number; }; },
) => {
  if (output.state.toolFailureMessages.length > 0) {
    return buildToolFailureVisibleMessage(output.state.toolFailureMessages);
  }

  if (output.transportResult.toolCallCount === 0) {
    return "模型进入了工具调用阶段，但没有实际执行任何工具。请调整问题范围，或让我先检查更具体的文件或目录。";
  }

  if (output.transportResult.toolResultCount === 0) {
    return "工具调用已开始，但没有返回可用结果，当前分析已停止。请调整问题范围，或让我先检查更具体的文件或目录。";
  }

  return "工具调用已完成，但在当前多步调用内仍未形成最终结果。请缩小分析范围，或指定更具体的文件或目录。";
};

const shouldFinalizeToolCallBoundary = (
  output: {
    transportResult: { finishReason: string; intentRequestText: string; };
  },
  requestExecutionResult?: { status: string; },
) => {
  return (
    output.transportResult.finishReason === "tool-calls"
    && output.transportResult.intentRequestText.trim() === ""
    && requestExecutionResult?.status === "continue"
  );
};

const resolveEnqueueTransition = (
  currentTask: { chainId: string },
  nextTask: { chainId: string },
): PipelineEnqueueTransition => {
  return nextTask.chainId === currentTask.chainId ? "follow_up" : "dispatch";
};

export const applyIntentRequestExecutionElement: PipelineElement<
  FormalConversationFlowState,
  FormalConversationFlowState
> = {
  name: "ApplyIntentRequestExecution",
  kind: "boundary",
  async process(input) {
    if (input.mode !== "intent_executed") {
      return input;
    }

    const output = input.output;
    const result = input.requestExecutionResult;

    if (shouldFinalizeToolCallBoundary(output, result)) {
      const visibleTextBuffer = buildToolBoundaryVisibleMessage(output);

      return {
        mode: "ready_to_finalize",
        finalization: {
          type: "complete",
          env: output.env,
          transportResult: {
            ...output.transportResult,
            text: visibleTextBuffer,
          },
          visibleTextBuffer,
          hasStreamedVisibleOutput: false,
        },
      };
    }

    if (result.status === "continue") {
      return {
        mode: "ready_to_finalize",
        finalization: {
          type: "complete",
          env: output.env,
          transportResult: output.transportResult,
          visibleTextBuffer: output.state.visibleTextBuffer,
          hasStreamedVisibleOutput: output.state.hasStreamedVisibleOutput,
        },
      };
    }

    const nextTask = result.nextTask;

    if (!nextTask) {
      return {
        mode: "ready_to_finalize",
        finalization: {
          type: "complete",
          env: output.env,
          transportResult: output.transportResult,
          visibleTextBuffer: output.state.visibleTextBuffer,
          hasStreamedVisibleOutput: output.state.hasStreamedVisibleOutput,
        },
      };
    }

    return {
      mode: "ready_to_finalize",
      finalization: {
        type: "enqueue",
        transition: resolveEnqueueTransition(output.env.task, nextTask),
        env: output.env,
        transportResult: output.transportResult,
        visibleTextBuffer: output.state.visibleTextBuffer,
        hasStreamedVisibleOutput: output.state.hasStreamedVisibleOutput,
        nextTask,
      },
    };
  },
};
