import type { PipelineElement } from "@/core/pipeline";
import type {
  PredictionExecution,
  PreparedPredictionRequest,
} from "../types";

export const executePredictionRequestElement: PipelineElement<
  PreparedPredictionRequest,
  PredictionExecution
> = {
  name: "ExecutePredictionRequest",
  async process(input) {
    if (!input.predictionRequest) {
      return {
        env: input.env,
      };
    }

    return {
      env: input.env,
      requestExecutionResult: await input.env.runtime.executeIntentRequests(
        input.env.task,
        [input.predictionRequest],
      ),
    };
  },
};
