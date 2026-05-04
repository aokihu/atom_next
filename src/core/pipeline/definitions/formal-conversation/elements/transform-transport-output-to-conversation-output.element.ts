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
