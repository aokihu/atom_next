/**
 * SyncRuntimeTask — binds the current task to the runtime boundary.
 *
 * Supports both the legacy env.runtime shape and the new pipeline context
 * shape so formal_conversation can migrate first without forcing the other
 * two pipelines to change in the same patch.
 */
import type { PipelineElement } from "@/core/pipeline";
import type { TaskItem } from "@/types/task";

type SyncRuntimeTaskContextInput = {
  context: {
    syncCurrentTask: () => void;
  };
};

type SyncRuntimeTaskEnvInput = {
  env: {
    task: TaskItem;
    runtime: {
      currentTask: TaskItem | undefined;
    };
  };
};

export const syncRuntimeTaskElement: PipelineElement<
  SyncRuntimeTaskContextInput | SyncRuntimeTaskEnvInput,
  any
> = {
  name: "SyncRuntimeTask",
  kind: "source",
  async process(input) {
    if ("context" in input) {
      input.context.syncCurrentTask();
      return input;
    }

    input.env.runtime.currentTask = input.env.task;
    return input;
  },
};
