import type { PipelineElement } from "@/core/pipeline";
import type { FormalConversationFlowState } from "../types";

export const parseIntentRequestsElement: PipelineElement<
  FormalConversationFlowState,
  FormalConversationFlowState
> = {
  name: "ParseIntentRequests",
  kind: "boundary",
  async process(input) {
    if (input.mode !== "conversation_output") {
      return input;
    }

    input.output.env.runtime.reportConversationOutputAnalysis({
      finishReason: String(input.output.transportResult.finishReason),
      visibleTextCharLength: input.output.state.visibleTextBuffer.length,
      intentRequestText: input.output.transportResult.intentRequestText,
      stepCount: input.output.transportResult.stepCount,
      toolCallCount: input.output.transportResult.toolCallCount,
      toolResultCount: input.output.transportResult.toolResultCount,
      responseMessageCount: input.output.transportResult.responseMessageCount,
    });

    return {
      mode: "intent_parsed",
      output: input.output,
      intentRequestResult: input.output.env.runtime.parseIntentRequest(
        input.output.transportResult.intentRequestText,
      ),
    };
  },
};
