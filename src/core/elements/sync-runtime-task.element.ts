import type { PipelineElement } from "@/core/pipeline";
import type { TaskItem } from "@/types/task";

export const syncRuntimeTaskElement: PipelineElement<
  { env: { task: TaskItem; runtime: { currentTask: TaskItem | undefined } } },
  any
> = {
  name: "SyncRuntimeTask",
  kind: "source",
  async process(input) {
    input.env.runtime.currentTask = input.env.task;
    return input;
  },
};
