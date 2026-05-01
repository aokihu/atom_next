import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import type {
  FormalConversationTransportOutput,
  ParsedIntentRequests,
} from "../types";

export const parseIntentRequestsElement = {
  name: "formal_conversation.parse_intent_requests",

  async process(
    input: FormalConversationTransportOutput,
    _context: PipelineContext,
  ): Promise<ParsedIntentRequests> {
    input.env.runtime.reportConversationOutputAnalysis({
      finishReason: String(input.transportResult.finishReason),
      visibleTextCharLength: input.visibleTextBuffer.length,
      intentRequestText: input.transportResult.intentRequestText,
      stepCount: input.transportResult.stepCount,
      toolCallCount: input.transportResult.toolCallCount,
      toolResultCount: input.transportResult.toolResultCount,
      responseMessageCount: input.transportResult.responseMessageCount,
    });

    return {
      env: input.env,
      transportResult: input.transportResult,
      visibleTextBuffer: input.visibleTextBuffer,
      hasStreamedVisibleOutput: input.hasStreamedVisibleOutput,
      toolCallStartCount: input.toolCallStartCount,
      toolCallFinishCount: input.toolCallFinishCount,
      toolFailureMessages: input.toolFailureMessages,
      intentRequestResult: input.env.runtime.parseIntentRequest(
        input.transportResult.intentRequestText,
      ),
    };
  },
} satisfies PipelineElement<
  FormalConversationTransportOutput,
  ParsedIntentRequests
>;
