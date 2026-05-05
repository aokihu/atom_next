/**
 * HandleLengthBoundary — fallback when the LLM output is truncated by token limit.
 *
 * If finishReason is "length" and no FOLLOW_UP intent request was generated,
 * and the task has a long_output followUpPolicy enabled, it enqueues a
 * POST_FOLLOW_UP task to generate continuation context.
 */
import type { PipelineElement } from "@/core/pipeline";
import type { TaskFollowUpPolicy } from "@/types/task";
import type { TaskItem } from "@/types/task";
import type { TransportOutput } from "@element/transport.element";
import type { FormalConversationFlowState } from "../types";

const normalizeFollowUpPolicy = (
  policy?: TaskFollowUpPolicy,
): TaskFollowUpPolicy => {
  return policy ?? { mode: "none" };
};

const shouldUseFollowUpFallback = (
  task: TaskItem,
  transportResult: TransportOutput,
) => {
  const policy = normalizeFollowUpPolicy(task.followUpPolicy);

  return (
    policy.mode !== "none" &&
    policy.reason === "long_output" &&
    transportResult.finishReason === "length" &&
    transportResult.intentRequestText.trim() === ""
  );
};

export const handleLengthBoundaryElement: PipelineElement<
  FormalConversationFlowState,
  FormalConversationFlowState
> = {
  name: "HandleLengthBoundary",
  kind: "boundary",
  async process(input) {
    if (input.mode !== "conversation_output") {
      return input;
    }

    const output = input.output;

    if (shouldUseFollowUpFallback(output.env.task, output.transportResult)) {
      return {
        mode: "ready_to_finalize",
        finalization: {
          type: "enqueue",
          transition: "follow_up",
          env: output.env,
          transportResult: output.transportResult,
          visibleTextBuffer: output.state.visibleTextBuffer,
          hasStreamedVisibleOutput: output.state.hasStreamedVisibleOutput,
          nextTask: output.env.runtime.createLengthLimitedPostFollowUpTask(
            output.env.task,
          ),
        },
      };
    }

    return input;
  },
};
