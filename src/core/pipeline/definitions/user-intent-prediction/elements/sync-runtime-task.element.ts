import type { PipelineElement } from "@/core/pipeline";
import type { UserIntentPredictionPipelineInput } from "../types";

export const syncRuntimeTaskElement: PipelineElement<
  UserIntentPredictionPipelineInput,
  UserIntentPredictionPipelineInput
> = {
  name: "SyncRuntimeTask",
  kind: "source",
  async process(input) {
    input.env.runtime.currentTask = input.env.task;
    return input;
  },
};
