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
  async process(input) {
    const [systemPrompt, userPrompt] = await input.env.runtime.exportPrompts();

    return {
      ...input,
      systemPrompt,
      userPrompt,
    };
  },
};
