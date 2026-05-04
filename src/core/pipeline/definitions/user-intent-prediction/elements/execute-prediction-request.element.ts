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
        env: input.env,
        predictionRequest: input.predictionRequest,
        requestExecutionResult: { status: "continue" },
      };
    }

    return {
      mode: "prediction_executed",
      env: input.env,
      predictionRequest: input.predictionRequest,
      requestExecutionResult: await input.env.runtime.executeIntentRequests(
        input.env.task,
        [input.predictionRequest],
      ),
    };
  },
};
