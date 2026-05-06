/**
 * ExecutePredictionRequest — executes the PREPARE_CONVERSATION intent request.
 *
 * If no prediction request was prepared, generates a continue result.
 * Otherwise calls runtime.executeIntentRequests to process the prediction.
 * Transitions from prediction_prepared → prediction_executed.
 */
import type { PipelineElement } from "@/core/pipeline";
import type { UserIntentPredictionFlowState } from "../types";

export const executePredictionRequestElement: PipelineElement<
  UserIntentPredictionFlowState,
  UserIntentPredictionFlowState
> = {
  name: "ExecutePredictionRequest",
  kind: "transform",
  async process(input) {
    if (input.mode !== "prediction_prepared") {
      return input;
    }

    if (!input.predictionRequest) {
      return {
        mode: "prediction_executed",
        context: input.context,
        state: input.state,
        predictionRequest: input.predictionRequest,
        requestExecutionResult: { status: "continue" },
      };
    }

    return {
      mode: "prediction_executed",
      context: input.context,
      state: input.state,
      predictionRequest: input.predictionRequest,
      requestExecutionResult: await input.context.executeIntentRequests(
        [input.predictionRequest],
      ),
    };
  },
};
