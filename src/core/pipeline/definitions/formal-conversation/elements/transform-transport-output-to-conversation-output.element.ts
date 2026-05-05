/**
 * TransformTransportOutputToConversationOutput — extracts transport result into pipeline output.
 *
 * Clears continuation context and wraps the raw transport output into the
 * pipeline's conversation output shape. Transitions into conversation_output stage.
 */
import type { PipelineElement } from "@/core/pipeline";
import type {
  FormalConversationFlowState,
  FormalConversationTransportResponse,
} from "../types";

export const transformTransportOutputToConversationOutputElement: PipelineElement<
  FormalConversationTransportResponse,
  FormalConversationFlowState
> = {
  name: "TransformTransportOutputToConversationOutput",
  kind: "transform",
  async process(input) {
    input.env.runtime.clearContinuationContext();

    return {
      mode: "conversation_output",
      output: {
        env: input.env,
        state: input.state,
        transportResult: input.transportOutput,
      },
    };
  },
};
