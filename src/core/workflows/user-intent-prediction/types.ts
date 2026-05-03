import type { PipelineResult } from "@/core/pipeline";
import type { TaskQueue } from "@/core/queue";
import type { Runtime } from "@/core/runtime";
import type { TaskItem } from "@/types/task";

export type UserIntentPredictionWorkflowEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
};

export type UserIntentPredictionPipelineInput = {
  env: UserIntentPredictionWorkflowEnv;
};

export type PreparedPredictionRequest = UserIntentPredictionPipelineInput & {
  predictionRequest: Awaited<ReturnType<Runtime["prepareExecutionContext"]>>;
};

export type PredictionExecution = UserIntentPredictionPipelineInput & {
  requestExecutionResult?: Awaited<
    ReturnType<Runtime["executeIntentRequests"]>
  >;
};

export const createUserIntentPredictionWorkflowEnv = (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
): UserIntentPredictionWorkflowEnv => {
  return {
    task,
    taskQueue,
    runtime,
  };
};

export type RunUserIntentPredictionWorkflowResult = PipelineResult;
