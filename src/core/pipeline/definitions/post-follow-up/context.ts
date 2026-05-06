import type { Runtime } from "@/core/runtime";
import type { TaskItem } from "@/types/task";

export type PostFollowUpPipelineContext = {
  task: TaskItem;
  syncCurrentTask: () => void;
  preparePostFollowUpContinuation: () => ReturnType<
    Runtime["preparePostFollowUpContinuation"]
  >;
  createContinuationFormalConversationTask: () => ReturnType<
    Runtime["createContinuationFormalConversationTask"]
  >;
};

export const createPostFollowUpPipelineContext = (
  task: TaskItem,
  deps: {
    runtime: Runtime;
  },
): PostFollowUpPipelineContext => {
  return {
    task,
    syncCurrentTask: () => {
      deps.runtime.currentTask = task;
    },
    preparePostFollowUpContinuation: () => {
      return deps.runtime.preparePostFollowUpContinuation();
    },
    createContinuationFormalConversationTask: () => {
      return deps.runtime.createContinuationFormalConversationTask(task);
    },
  };
};
