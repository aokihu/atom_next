import type {
  PipelineDefinition,
  PipelineResult,
} from "../..";
import { createPipelineEnv } from "../..";
import type { UserIntentPredictionPipelineInput } from "./types";
import { syncRuntimeTaskElement } from "@element/sync-runtime-task.element";
import { preparePredictionRequestElement } from "./elements/prepare-prediction-request.element";
import { executePredictionRequestElement } from "./elements/execute-prediction-request.element";
import { applyPredictionExecutionElement } from "./elements/apply-prediction-execution.element";
import { finalizeUserIntentPredictionElement } from "./elements/finalize-user-intent-prediction.element";

export const userIntentPredictionPipeline: PipelineDefinition<
  UserIntentPredictionPipelineInput,
  PipelineResult
> = {
  name: "user-intent-prediction",

  createInput(task, deps) {
    return {
      env: createPipelineEnv(
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
        applyPredictionExecutionElement,
        finalizeUserIntentPredictionElement,
      ],
    };
  },
};
