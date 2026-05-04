import type { PipelineElement } from "@/core/pipeline";
import type { PostFollowUpFlowState } from "../types";

export const applyPostFollowUpContinuationElement: PipelineElement<
  PostFollowUpFlowState,
  PostFollowUpFlowState
> = {
  name: "ApplyPostFollowUpContinuation",
  kind: "boundary",
  async process(input) {
    if (input.mode !== "continuation_prepared") {
      return input;
    }

    return {
      mode: "ready_to_finalize",
      finalization: {
        type: "enqueue",
        env: input.env,
        transition: "dispatch",
        nextTask: input.nextTask,
      },
    };
  },
};
