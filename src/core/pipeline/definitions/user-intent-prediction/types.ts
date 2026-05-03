import type { PipelineResult } from "@/core/pipeline";
import type { TaskQueue } from "@/core/queue";
import type { Runtime } from "@/core/runtime";
import type { TaskItem } from "@/types/task";

export type UserIntentPredictionPipelineEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
};

export type UserIntentPredictionPipelineInput = {
  env: UserIntentPredictionPipelineEnv;
};

export type PreparedPredictionRequest = UserIntentPredictionPipelineInput & {
  predictionRequest: Awaited<ReturnType<Runtime["prepareExecutionContext"]>>;
};

export type PredictionExecution = UserIntentPredictionPipelineInput & {
  requestExecutionResult?: Awaited<
    ReturnType<Runtime["executeIntentRequests"]>
  >;
};

export const createUserIntentPredictionPipelineEnv = (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
): UserIntentPredictionPipelineEnv => {
  return {
    task,
    taskQueue,
    runtime,
  };
};

export type RunUserIntentPredictionPipelineResult = PipelineResult;
