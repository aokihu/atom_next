import type { PipelineElement } from "@/core/pipeline";
import type { FormalConversationPipelineInput } from "../types";

export const syncRuntimeTaskElement: PipelineElement<
  FormalConversationPipelineInput,
  FormalConversationPipelineInput
> = {
  name: "SyncRuntimeTask",
  async process(input) {
    input.env.runtime.currentTask = input.env.task;
    return input;
  },
};
