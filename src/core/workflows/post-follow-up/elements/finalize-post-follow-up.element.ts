import type { PipelineElement } from "@/core/pipeline";
import { TaskState } from "@/types";
import type {
  PreparedPostFollowUp,
  RunPostFollowUpWorkflowResult,
} from "../types";

export const finalizePostFollowUpElement: PipelineElement<
  PreparedPostFollowUp,
  RunPostFollowUpWorkflowResult
> = {
  name: "FinalizePostFollowUp",
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
