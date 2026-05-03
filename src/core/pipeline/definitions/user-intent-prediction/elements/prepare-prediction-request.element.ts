import type { PipelineElement } from "@/core/pipeline";
import type {
  PreparedPredictionRequest,
  UserIntentPredictionPipelineInput,
} from "../types";

export const preparePredictionRequestElement: PipelineElement<
  UserIntentPredictionPipelineInput,
  PreparedPredictionRequest
> = {
  name: "PreparePredictionRequest",
  kind: "source",
  async process(input) {
    return {
      ...input,
      predictionRequest: await input.env.runtime.prepareExecutionContext(
        input.env.task,
      ),
    };
  },
};
