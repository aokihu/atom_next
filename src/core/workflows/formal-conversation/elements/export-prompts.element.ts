import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import type {
  FormalConversationPrompts,
  FormalConversationWorkflowEnv,
} from "../types";

export const exportPromptsElement = {
  name: "formal_conversation.export_prompts",

  async process(
    env: FormalConversationWorkflowEnv,
    _context: PipelineContext,
  ): Promise<FormalConversationPrompts> {
    const [systemPrompt, userPrompt] = await env.runtime.exportPrompts();

    return {
      env,
      systemPrompt,
      userPrompt,
    };
  },
} satisfies PipelineElement<FormalConversationWorkflowEnv, FormalConversationPrompts>;
