/**
 * ApplyPredictionExecution — maps prediction execution result to finalization.
 *
 * If no result, status is continue, or no nextTask → complete.
 * Otherwise → enqueue (dispatch, spawning a formal conversation task).
 */
import type { PipelineElement } from "@/core/pipeline";
import type { UserIntentPredictionFlowState } from "../types";

export const applyPredictionExecutionElement: PipelineElement<
  UserIntentPredictionFlowState,
  UserIntentPredictionFlowState
> = {
  name: "ApplyPredictionExecution",
  kind: "boundary",
  async process(input) {
    if (input.mode !== "prediction_executed") {
      return input;
    }

    const result = input.requestExecutionResult;

    if (!result || result.status === "continue" || !result.nextTask) {
      return {
        mode: "ready_to_finalize",
        finalization: {
          type: "complete",
          env: input.env,
        },
      };
    }

    return {
      mode: "ready_to_finalize",
      finalization: {
        type: "enqueue",
        env: input.env,
        transition: "dispatch",
        nextTask: result.nextTask,
      },
    };
  },
};
