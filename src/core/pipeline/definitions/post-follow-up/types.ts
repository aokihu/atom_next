import type { PipelineResult } from "@/core/pipeline";
import type { TaskQueue } from "@/core/queue";
import type { Runtime } from "@/core/runtime";
import type { TaskItem } from "@/types/task";

export type PostFollowUpPipelineEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
};

export type PostFollowUpPipelineInput = {
  env: PostFollowUpPipelineEnv;
};

export type PreparedPostFollowUp = PostFollowUpPipelineInput & {
  nextTask: ReturnType<Runtime["createContinuationFormalConversationTask"]>;
};

export const createPostFollowUpPipelineEnv = (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
): PostFollowUpPipelineEnv => {
  return {
    task,
    taskQueue,
    runtime,
  };
};

export type RunPostFollowUpPipelineResult = PipelineResult;
