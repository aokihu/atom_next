import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import type { FormalConversationWorkflowEnv } from "../types";

export const syncRuntimeTaskElement = {
  name: "formal_conversation.sync_runtime_task",

  async process(
    env: FormalConversationWorkflowEnv,
    _context: PipelineContext,
  ): Promise<FormalConversationWorkflowEnv> {
    env.runtime.currentTask = env.task;
    return env;
  },
} satisfies PipelineElement<
  FormalConversationWorkflowEnv,
  FormalConversationWorkflowEnv
>;
