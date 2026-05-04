import type { PipelineElement } from "@/core/pipeline";
import type {
  UserIntentPredictionFlowState,
  UserIntentPredictionPipelineInput,
} from "../types";

export const preparePredictionRequestElement: PipelineElement<
  UserIntentPredictionPipelineInput,
  UserIntentPredictionFlowState
> = {
  name: "PreparePredictionRequest",
  kind: "source",
  async process(input) {
    return {
      mode: "prediction_prepared",
      env: input.env,
      predictionRequest: await input.env.runtime.prepareExecutionContext(
        input.env.task,
      ),
    };
  },
};
