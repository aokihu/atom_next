import type { PipelineElement } from "@/core/pipeline";
import { TaskState } from "@/types/task";
import type {
  FormalConversationConversationOutput,
  FormalConversationFlowState,
} from "../types";

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
  FormalConversationConversationOutput,
  FormalConversationFlowState
> = {
  name: "HandleToolBoundary",
  kind: "boundary",
  async process(input) {
    if (!shouldExecutePendingToolCalls(input)) {
      return {
        mode: "intent_requests",
        output: input,
      };
    }

    const toolExecutionResult = await input.env.runtime.executeConversationToolCalls(
      input.transportResult.pendingToolCalls ?? [],
    );

    if (!toolExecutionResult.ok) {
      const visibleTextBuffer = buildToolExecutionFailureMessage(
        toolExecutionResult.reason ?? "",
      );

      return {
        mode: "ready_to_finalize",
        finalization: {
          env: input.env,
          transportResult: {
            ...input.transportResult,
            text: visibleTextBuffer,
          },
          visibleTextBuffer,
          hasStreamedVisibleOutput: false,
          shouldComplete: true,
        },
      };
    }

    input.env.taskQueue.updateTask(
      input.env.task.id,
      { state: TaskState.FOLLOW_UP },
      { shouldSyncEvent: false },
    );

    return {
      mode: "ready_to_finalize",
      finalization: {
        env: input.env,
        transportResult: input.transportResult,
        visibleTextBuffer: input.state.visibleTextBuffer,
        hasStreamedVisibleOutput: input.state.hasStreamedVisibleOutput,
        shouldComplete: false,
        nextTask: input.env.runtime.createContinuationFormalConversationTask(
          input.env.task,
        ),
      },
    };
  },
};
