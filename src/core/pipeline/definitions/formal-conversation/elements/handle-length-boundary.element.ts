import type { PipelineElement } from "@/core/pipeline";
import type { TaskFollowUpPolicy } from "@/types/task";
import type { TaskItem } from "@/types/task";
import type { TransportOutput } from "@/core/elements/transport.element";
import type {
  FormalConversationConversationOutput,
  FormalConversationFlowState,
} from "../types";

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
  FormalConversationConversationOutput,
  FormalConversationFlowState
> = {
  name: "HandleLengthBoundary",
  kind: "boundary",
  async process(input) {
    if (shouldUseFollowUpFallback(input.env.task, input.transportResult)) {
      return {
        mode: "ready_to_finalize",
        finalization: {
          type: "enqueue",
          transition: "follow_up",
          env: input.env,
          transportResult: input.transportResult,
          visibleTextBuffer: input.state.visibleTextBuffer,
          hasStreamedVisibleOutput: input.state.hasStreamedVisibleOutput,
          nextTask: input.env.runtime.createLengthLimitedPostFollowUpTask(
            input.env.task,
          ),
        },
      };
    }

    return {
      mode: "intent_requests",
      output: input,
    };
  },
};
