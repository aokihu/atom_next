import type { PipelineElement } from "@/core/pipeline";
import type { PostFollowUpPipelineInput } from "../types";

export const syncRuntimeTaskElement: PipelineElement<
  PostFollowUpPipelineInput,
  PostFollowUpPipelineInput
> = {
  name: "SyncRuntimeTask",
  async process(input) {
    input.env.runtime.currentTask = input.env.task;
    return input;
  },
};
