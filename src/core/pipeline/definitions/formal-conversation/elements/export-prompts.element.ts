/**
 * ExportPrompts — reads system and user prompts from runtime.
 *
 * Transitions from pipeline input → prompts, extracting system prompt
 * and user prompt via runtime.exportPrompts().
 */
import type { PipelineElement } from "@/core/pipeline";
import type {
  FormalConversationPipelineInput,
  FormalConversationPrompts,
} from "../types";

export const exportPromptsElement: PipelineElement<
  FormalConversationPipelineInput,
  FormalConversationPrompts
> = {
  name: "ExportPrompts",
  kind: "source",
  async process(input) {
    const [systemPrompt, userPrompt] = await input.env.runtime.exportPrompts();

    return {
      ...input,
      systemPrompt,
      userPrompt,
    };
  },
};
