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
    await input.env.runtime.preparePostFollowUpContinuation();

    return {
      mode: "continuation_prepared",
      env: input.env,
      nextTask: input.env.runtime.createContinuationFormalConversationTask(
        input.env.task,
      ),
    };
  },
};
