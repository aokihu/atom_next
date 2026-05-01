import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import type {
  FormalConversationPrompts,
  FormalConversationTransportPayload,
} from "../types";

export const transformPromptsToTransportPayloadElement = {
  name: "formal_conversation.transform_prompts_to_transport_payload",

  async process(
    input: FormalConversationPrompts,
    _context: PipelineContext,
  ): Promise<FormalConversationTransportPayload> {
    const tools = input.env.runtime.createConversationToolRegistry();

    return {
      env: input.env,
      payload: {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        options: {
          maxOutputTokens:
            input.env.runtime.getFormalConversationMaxOutputTokens(),
          maxToolSteps: input.env.runtime.getFormalConversationMaxToolSteps(),
          tools,
        },
      },
    };
  },
} satisfies PipelineElement<
  FormalConversationPrompts,
  FormalConversationTransportPayload
>;
