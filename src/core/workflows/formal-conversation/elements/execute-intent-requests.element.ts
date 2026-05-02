import type { PipelineElement } from "@/core/pipeline";
import type { FormalConversationFlowState } from "../types";

export const executeIntentRequestsElement: PipelineElement<
  FormalConversationFlowState,
  FormalConversationFlowState
> = {
  name: "ExecuteIntentRequests",
  async process(input) {
    if (input.mode === "ready_to_finalize") {
      return input;
    }

    if (!input.intentRequestResult) {
      throw new Error("Intent request result is missing before execution");
    }

    return {
      ...input,
      requestExecutionResult: await input.output.env.runtime.executeIntentRequests(
        input.output.env.task,
        input.intentRequestResult.safeRequests,
      ),
    };
  },
};
