/**
 * ExecuteIntentRequests — executes parsed intent requests via runtime.
 *
 * Takes the safe intent requests from intent_parsed stage and executes them.
 * Transitions from intent_parsed → intent_executed.
 */
import type { PipelineElement } from "@/core/pipeline";
import type { FormalConversationFlowState } from "../types";

export const executeIntentRequestsElement: PipelineElement<
  FormalConversationFlowState,
  FormalConversationFlowState
> = {
  name: "ExecuteIntentRequests",
  kind: "transform",
  async process(input) {
    if (input.mode !== "intent_parsed") {
      return input;
    }

    return {
      mode: "intent_executed",
      output: input.output,
      intentRequestResult: input.intentRequestResult,
      requestExecutionResult: await input.output.context.executeIntentRequests(
        input.intentRequestResult.safeRequests,
      ),
    };
  },
};
