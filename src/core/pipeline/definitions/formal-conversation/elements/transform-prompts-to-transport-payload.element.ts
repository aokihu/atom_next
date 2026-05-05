/**
 * TransformPromptsToTransportPayload — wraps prompts into a transport payload.
 *
 * Builds the TransportPayload from system/user prompts, including
 * maxOutputTokens, maxToolSteps, and tool registry.
 */
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
