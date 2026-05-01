import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import type {
  ExecutedIntentRequests,
  ParsedIntentRequests,
} from "../types";

export const executeIntentRequestsElement = {
  name: "formal_conversation.execute_intent_requests",

  async process(
    input: ParsedIntentRequests,
    _context: PipelineContext,
  ): Promise<ExecutedIntentRequests> {
    return {
      env: input.env,
      transportResult: input.transportResult,
      visibleTextBuffer: input.visibleTextBuffer,
      hasStreamedVisibleOutput: input.hasStreamedVisibleOutput,
      toolCallStartCount: input.toolCallStartCount,
      toolCallFinishCount: input.toolCallFinishCount,
      toolFailureMessages: input.toolFailureMessages,
      requestExecutionResult: await input.env.runtime.executeIntentRequests(
        input.env.task,
        input.intentRequestResult.safeRequests,
      ),
    };
  },
} satisfies PipelineElement<ParsedIntentRequests, ExecutedIntentRequests>;
