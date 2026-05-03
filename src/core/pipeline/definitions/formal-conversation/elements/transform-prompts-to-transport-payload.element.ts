import type { PipelineElement } from "@/core/pipeline";
import type {
  FormalConversationPrompts,
  FormalConversationTransportInput,
} from "../types";

export const transformPromptsToTransportPayloadElement: PipelineElement<
  FormalConversationPrompts,
  FormalConversationTransportInput
> = {
  name: "TransformPromptsToTransportPayload",
  kind: "transform",
  async process(input) {
    return {
      ...input,
      transportPayload: {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        options: {
          maxOutputTokens: input.env.runtime.getFormalConversationMaxOutputTokens(),
          maxToolSteps: input.env.runtime.getFormalConversationMaxToolSteps(),
          tools: input.env.runtime.createConversationToolRegistry(),
        },
      },
    };
  },
};
