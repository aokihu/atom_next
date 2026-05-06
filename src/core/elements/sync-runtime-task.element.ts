/**
 * SyncRuntimeTask — binds the current task to the runtime boundary.
 */
import type { PipelineElement } from "@/core/pipeline";
 
type SyncRuntimeTaskInput = {
  context: {
    syncCurrentTask: () => void;
  };
};

export const syncRuntimeTaskElement: PipelineElement<
  SyncRuntimeTaskInput,
  any
> = {
  name: "SyncRuntimeTask",
  kind: "source",
  async process(input) {
    input.context.syncCurrentTask();
    return input;
  },
};
