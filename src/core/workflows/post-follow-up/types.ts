import type { PipelineResult } from "@/core/pipeline";
import type { TaskQueue } from "@/core/queue";
import type { Runtime } from "@/core/runtime";
import type { TaskItem } from "@/types/task";

export type PostFollowUpWorkflowEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
};

export type PostFollowUpPipelineInput = {
  env: PostFollowUpWorkflowEnv;
};

export type PreparedPostFollowUp = PostFollowUpPipelineInput & {
  nextTask: ReturnType<Runtime["createContinuationFormalConversationTask"]>;
};

export const createPostFollowUpWorkflowEnv = (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
): PostFollowUpWorkflowEnv => {
  return {
    task,
    taskQueue,
    runtime,
  };
};

export type RunPostFollowUpWorkflowResult = PipelineResult;
