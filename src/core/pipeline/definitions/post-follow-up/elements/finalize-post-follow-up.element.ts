/**
 * FinalizePostFollowUp — terminal element for post follow-up pipeline.
 *
 * Only accepts ready_to_finalize; converts the finalization to PipelineResult
 * via toPipelineResult().
 */
import type { PipelineElement } from "@/core/pipeline";
import type {
  PostFollowUpFlowState,
  RunPostFollowUpPipelineResult,
} from "../types";

export const finalizePostFollowUpElement: PipelineElement<
  PostFollowUpFlowState,
  RunPostFollowUpPipelineResult
> = {
  name: "FinalizePostFollowUp",
  kind: "sink",
  async process(input) {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("Post follow-up pipeline did not reach finalize state");
    }

    if (input.finalization.type === "enqueue") {
      return {
        type: "enqueue",
        transition: input.finalization.transition,
        task: input.finalization.context.task,
        nextTask: input.finalization.nextTask,
      };
    }

    return {
      type: "complete",
      task: input.finalization.context.task,
    };
  },
};
