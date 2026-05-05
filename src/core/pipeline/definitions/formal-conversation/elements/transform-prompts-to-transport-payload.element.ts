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
    const tools =
      input.context.transport.tools
      ?? input.context.createConversationToolRegistry();

    return {
      ...input,
      transportPayload: {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        options: {
          maxOutputTokens: input.context.transport.maxOutputTokens,
          maxToolSteps: input.context.transport.maxToolSteps,
          tools,
        },
      },
    };
  },
};
