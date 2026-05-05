/**
 * PreparePredictionRequest — calls runtime.prepareExecutionContext.
 *
 * Predicts user intent via the LLM prediction prompt, then records
 * the prediction result for policy resolution.
 * Transitions to prediction_prepared stage.
 */
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
