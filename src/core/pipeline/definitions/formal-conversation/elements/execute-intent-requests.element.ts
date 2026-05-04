import type { PipelineElement } from "@/core/pipeline";
import type { FormalConversationFlowState } from "../types";

export const executeIntentRequestsElement: PipelineElement<
  FormalConversationFlowState,
  FormalConversationFlowState
> = {
  name: "ExecuteIntentRequests",
  kind: "boundary",
  async process(input) {
    if (input.mode !== "intent_parsed") {
      return input;
    }

    return {
      mode: "intent_executed",
      output: input.output,
      intentRequestResult: input.intentRequestResult,
      requestExecutionResult: await input.output.env.runtime.executeIntentRequests(
        input.output.env.task,
        input.intentRequestResult.safeRequests,
      ),
    };
  },
};
