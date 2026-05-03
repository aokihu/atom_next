import type { TaskItem } from "@/types/task";
import type { ServiceManager } from "@/libs/service-manage";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";
import {
  PipelineEventBus,
  PipelineRunner,
  type Pipeline,
  type PipelineEventMap,
} from "../pipeline";
import {
  createUserIntentPredictionWorkflowEnv,
  type RunUserIntentPredictionWorkflowResult,
  type UserIntentPredictionPipelineInput,
} from "./user-intent-prediction/types";
import { syncRuntimeTaskElement } from "./user-intent-prediction/elements/sync-runtime-task.element";
import { preparePredictionRequestElement } from "./user-intent-prediction/elements/prepare-prediction-request.element";
import { executePredictionRequestElement } from "./user-intent-prediction/elements/execute-prediction-request.element";
import { finalizeUserIntentPredictionElement } from "./user-intent-prediction/elements/finalize-user-intent-prediction.element";

const createUserIntentPredictionPipeline = (): Pipeline<
  UserIntentPredictionPipelineInput,
  RunUserIntentPredictionWorkflowResult
> => {
  return {
    name: "UserIntentPrediction",
    elements: [
      syncRuntimeTaskElement,
      preparePredictionRequestElement,
      executePredictionRequestElement,
      finalizeUserIntentPredictionElement,
    ],
  };
};

export const runUserIntentPredictionWorkflow = async (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  _serviceManager: ServiceManager,
) => {
  const env = createUserIntentPredictionWorkflowEnv(task, taskQueue, runtime);
  const eventBus = new PipelineEventBus<PipelineEventMap>();
  const input = { env };
  const runner = new PipelineRunner();

  return runner.run(
    createUserIntentPredictionPipeline(),
    input,
    {
      task,
      eventBus,
    },
  );
};
