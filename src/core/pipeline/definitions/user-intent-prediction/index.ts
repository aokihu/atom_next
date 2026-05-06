/**
 * UserIntentPrediction pipeline definition.
 *
 * Element chain:
 *   SyncRuntimeTask → PreparePredictionRequest → ExecutePredictionRequest →
 *   ApplyPredictionExecution → FinalizeUserIntentPrediction
 */
import type {
  PipelineDefinition,
  PipelineResult,
} from "../..";
import type { UserIntentPredictionPipelineInput } from "./types";
import { createUserIntentPredictionPipelineContext } from "./context";
import { createUserIntentPredictionPipelineState } from "./types";
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
      context: createUserIntentPredictionPipelineContext(task, {
        runtime: deps.runtime,
      }),
      state: createUserIntentPredictionPipelineState(),
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
