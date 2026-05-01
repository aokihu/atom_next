import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import type {
  FormalConversationPipelineState,
  FormalConversationTransportOutput,
  FormalConversationTransportOutputSeed,
} from "../types";

export const createTransformTransportOutputToConversationOutputElement = (
  state: FormalConversationPipelineState,
) => ({
  name: "formal_conversation.transform_transport_output_to_conversation_output",

  async process(
    input: FormalConversationTransportOutputSeed,
    _context: PipelineContext,
  ): Promise<FormalConversationTransportOutput> {
    input.env.runtime.clearContinuationContext();

    return {
      env: input.env,
      transportResult: input.output,
      visibleTextBuffer: state.visibleTextBuffer,
      hasStreamedVisibleOutput: state.hasStreamedVisibleOutput,
      toolCallStartCount: state.toolCallStartCount,
      toolCallFinishCount: state.toolCallFinishCount,
      toolFailureMessages: state.toolFailureMessages,
    };
  },
}) satisfies PipelineElement<
  FormalConversationTransportOutputSeed,
  FormalConversationTransportOutput
>;
