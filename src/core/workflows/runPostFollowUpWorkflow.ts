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
  createPostFollowUpWorkflowEnv,
  type PostFollowUpPipelineInput,
  type RunPostFollowUpWorkflowResult,
} from "./post-follow-up/types";
import { syncRuntimeTaskElement } from "./post-follow-up/elements/sync-runtime-task.element";
import { prepareContinuationElement } from "./post-follow-up/elements/prepare-continuation.element";
import { finalizePostFollowUpElement } from "./post-follow-up/elements/finalize-post-follow-up.element";

const createPostFollowUpPipeline = (): Pipeline<
  PostFollowUpPipelineInput,
  RunPostFollowUpWorkflowResult
> => {
  return {
    name: "PostFollowUp",
    elements: [
      syncRuntimeTaskElement,
      prepareContinuationElement,
      finalizePostFollowUpElement,
    ],
  };
};

export const runPostFollowUpWorkflow = async (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  _serviceManager: ServiceManager,
) => {
  const env = createPostFollowUpWorkflowEnv(task, taskQueue, runtime);
  const eventBus = new PipelineEventBus<PipelineEventMap>();
  const input = { env };
  const runner = new PipelineRunner();

  return runner.run(
    createPostFollowUpPipeline(),
    input,
    {
      task,
      eventBus,
    },
  );
};
