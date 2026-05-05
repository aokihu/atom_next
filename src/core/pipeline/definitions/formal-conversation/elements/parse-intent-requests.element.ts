/**
 * ParseIntentRequests — parses intent request text from the LLM output.
 *
 * Reads intentRequestText from the transport result, reports conversation
 * output analysis, and parses intent requests via runtime.parseIntentRequest.
 * Transitions from conversation_output → intent_parsed.
 */
import type { PipelineElement } from "@/core/pipeline";
import type { FormalConversationFlowState } from "../types";

export const parseIntentRequestsElement: PipelineElement<
  FormalConversationFlowState,
  FormalConversationFlowState
> = {
  name: "ParseIntentRequests",
  kind: "transform",
  async process(input) {
    if (input.mode !== "conversation_output") {
      return input;
    }

    input.output.context.reportConversationOutputAnalysis({
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
      intentRequestResult: input.output.context.parseIntentRequest(
        input.output.transportResult.intentRequestText,
      ),
    };
  },
};
