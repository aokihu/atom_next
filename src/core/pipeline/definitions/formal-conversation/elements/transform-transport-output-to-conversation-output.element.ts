import type { PipelineElement } from "@/core/pipeline";
import type {
  FormalConversationConversationOutput,
  FormalConversationTransportResponse,
} from "../types";

export const transformTransportOutputToConversationOutputElement: PipelineElement<
  FormalConversationTransportResponse,
  FormalConversationConversationOutput
> = {
  name: "TransformTransportOutputToConversationOutput",
  kind: "transform",
  async process(input) {
    input.env.runtime.clearContinuationContext();

    return {
      env: input.env,
      state: input.state,
      transportResult: input.transportOutput,
    };
  },
};
