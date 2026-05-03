import type {
  PipelineDefinition,
  PipelineResult,
} from "../..";
import type {
  UserIntentPredictionPipelineInput,
  RunUserIntentPredictionPipelineResult,
} from "./types";
import { createUserIntentPredictionPipelineEnv } from "./types";
import { syncRuntimeTaskElement } from "./elements/sync-runtime-task.element";
import { preparePredictionRequestElement } from "./elements/prepare-prediction-request.element";
import { executePredictionRequestElement } from "./elements/execute-prediction-request.element";
import { finalizeUserIntentPredictionElement } from "./elements/finalize-user-intent-prediction.element";

export const userIntentPredictionPipeline: PipelineDefinition<
  UserIntentPredictionPipelineInput,
  PipelineResult
> = {
  name: "user-intent-prediction",

  createInput(task, deps) {
    return {
      env: createUserIntentPredictionPipelineEnv(
        task,
        deps.taskQueue,
        deps.runtime,
      ),
    };
  },

  createPipeline() {
    return {
      name: "UserIntentPrediction",
      elements: [
        syncRuntimeTaskElement,
        preparePredictionRequestElement,
        executePredictionRequestElement,
        finalizeUserIntentPredictionElement,
      ],
    };
  },
};

export type { RunUserIntentPredictionPipelineResult };
