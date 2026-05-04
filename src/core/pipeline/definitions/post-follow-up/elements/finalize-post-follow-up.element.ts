import type { PipelineElement } from "@/core/pipeline";
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
    return {
      type: "enqueue",
      transition: "dispatch",
      task: input.env.task,
      nextTask: input.nextTask,
    };
  },
};
