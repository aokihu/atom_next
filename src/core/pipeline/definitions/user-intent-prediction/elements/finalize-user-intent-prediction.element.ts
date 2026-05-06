/**
 * FinalizeUserIntentPrediction — terminal element for user intent prediction.
 *
 * Only accepts ready_to_finalize; converts the finalization to PipelineResult
 * via toPipelineResult().
 */
import type { PipelineElement } from "@/core/pipeline";
import type {
  UserIntentPredictionFlowState,
  RunUserIntentPredictionPipelineResult,
} from "../types";

export const finalizeUserIntentPredictionElement: PipelineElement<
  UserIntentPredictionFlowState,
  RunUserIntentPredictionPipelineResult
> = {
  name: "FinalizeUserIntentPrediction",
  kind: "sink",
  async process(input) {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("User intent prediction pipeline did not reach finalize state");
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
