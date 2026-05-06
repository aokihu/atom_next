/**
 * PrepareContinuation — prepares post follow-up continuation.
 *
 * Calls runtime.preparePostFollowUpContinuation to generate summary/nextPrompt/avoidRepeat,
 * then creates the formal conversation continuation task.
 * Transitions to continuation_prepared stage.
 */
import type { PipelineElement } from "@/core/pipeline";
import type {
  PostFollowUpFlowState,
  PostFollowUpPipelineInput,
} from "../types";

export const prepareContinuationElement: PipelineElement<
  PostFollowUpPipelineInput,
  PostFollowUpFlowState
> = {
  name: "PrepareContinuation",
  kind: "transform",
  async process(input) {
    await input.context.preparePostFollowUpContinuation();

    return {
      mode: "continuation_prepared",
      context: input.context,
      state: input.state,
      nextTask: input.context.createContinuationFormalConversationTask(),
    };
  },
};
