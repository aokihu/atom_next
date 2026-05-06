import type { Runtime } from "@/core/runtime";
import type { TaskItem } from "@/types/task";

export type UserIntentPredictionPipelineContext = {
  task: TaskItem;
  syncCurrentTask: () => void;
  prepareExecutionContext: () => ReturnType<Runtime["prepareExecutionContext"]>;
  executeIntentRequests: (
    requests: Parameters<Runtime["executeIntentRequests"]>[1],
  ) => ReturnType<Runtime["executeIntentRequests"]>;
};

export const createUserIntentPredictionPipelineContext = (
  task: TaskItem,
  deps: {
    runtime: Runtime;
  },
): UserIntentPredictionPipelineContext => {
  return {
    task,
    syncCurrentTask: () => {
      deps.runtime.currentTask = task;
    },
    prepareExecutionContext: () => {
      return deps.runtime.prepareExecutionContext(task);
    },
    executeIntentRequests: (requests) => {
      return deps.runtime.executeIntentRequests(task, requests);
    },
  };
};
