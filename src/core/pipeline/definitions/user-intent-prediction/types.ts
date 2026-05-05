/**
 * UserIntentPrediction pipeline types.
 *
 * Predicts user intent before the formal conversation starts,
 * sets the followUpPolicy, and creates the formal conversation task.
 *
 * FlowState stages: prediction_prepared → prediction_executed → ready_to_finalize.
 */
import type {
  PipelineEnv,
  PipelineFinalizationInput,
  PipelineResult,
} from "@/core/pipeline";

export type UserIntentPredictionPipelineEnv = PipelineEnv;

export type UserIntentPredictionPipelineInput = {
  env: UserIntentPredictionPipelineEnv;
};

export type UserIntentPredictionFinalizationInput =
  PipelineFinalizationInput<UserIntentPredictionPipelineEnv>;

export type UserIntentPredictionFlowState =
  | {
      mode: "prediction_prepared";
      env: UserIntentPredictionPipelineEnv;
      predictionRequest: Awaited<
        ReturnType<import("@/core/runtime").Runtime["prepareExecutionContext"]>
      >;
    }
  | {
      mode: "prediction_executed";
      env: UserIntentPredictionPipelineEnv;
      predictionRequest: Awaited<
        ReturnType<import("@/core/runtime").Runtime["prepareExecutionContext"]>
      >;
      requestExecutionResult: Awaited<
        ReturnType<import("@/core/runtime").Runtime["executeIntentRequests"]>
      >;
    }
  | {
      mode: "ready_to_finalize";
      finalization: UserIntentPredictionFinalizationInput;
    };

export type RunUserIntentPredictionPipelineResult = PipelineResult;
