/**
 * UserIntentPrediction pipeline types.
 *
 * Predicts user intent before the formal conversation starts,
 * sets the followUpPolicy, and creates the formal conversation task.
 *
 * FlowState stages: prediction_prepared → prediction_executed → ready_to_finalize.
 */
import type {
  PipelineResult,
} from "@/core/pipeline";
import type { TaskItem } from "@/types/task";
import type { UserIntentPredictionPipelineContext } from "./context";

export type UserIntentPredictionPipelineState = Record<string, never>;

export type UserIntentPredictionPipelineInput = {
  context: UserIntentPredictionPipelineContext;
  state: UserIntentPredictionPipelineState;
};

export type UserIntentPredictionFinalizationInput =
  | {
      type: "complete";
      context: UserIntentPredictionPipelineContext;
    }
  | {
      type: "enqueue";
      context: UserIntentPredictionPipelineContext;
      transition: "dispatch";
      nextTask: TaskItem;
    };

export type UserIntentPredictionFlowState =
  | {
      mode: "prediction_prepared";
      context: UserIntentPredictionPipelineContext;
      state: UserIntentPredictionPipelineState;
      predictionRequest: Awaited<
        ReturnType<import("@/core/runtime").Runtime["prepareExecutionContext"]>
      >;
    }
  | {
      mode: "prediction_executed";
      context: UserIntentPredictionPipelineContext;
      state: UserIntentPredictionPipelineState;
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

export const createUserIntentPredictionPipelineState =
  (): UserIntentPredictionPipelineState => {
    return {};
  };
