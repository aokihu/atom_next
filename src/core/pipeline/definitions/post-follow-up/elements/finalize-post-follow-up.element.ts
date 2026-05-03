import type { PipelineElement } from "@/core/pipeline";
import { TaskState } from "@/types";
import type {
  PreparedPostFollowUp,
  RunPostFollowUpPipelineResult,
} from "../types";

export const finalizePostFollowUpElement: PipelineElement<
  PreparedPostFollowUp,
  RunPostFollowUpPipelineResult
> = {
  name: "FinalizePostFollowUp",
  kind: "sink",
  async process(input) {
    input.env.taskQueue.updateTask(
      input.env.task.id,
      { state: TaskState.COMPLETED },
      { shouldSyncEvent: false },
    );

    return {
      type: "enqueue",
      nextTask: input.nextTask,
    };
  },
};
