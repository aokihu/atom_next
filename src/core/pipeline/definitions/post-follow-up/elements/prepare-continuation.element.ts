import type { PipelineElement } from "@/core/pipeline";
import type {
  PostFollowUpPipelineInput,
  PreparedPostFollowUp,
} from "../types";

export const prepareContinuationElement: PipelineElement<
  PostFollowUpPipelineInput,
  PreparedPostFollowUp
> = {
  name: "PrepareContinuation",
  kind: "transform",
  async process(input) {
    await input.env.runtime.preparePostFollowUpContinuation();

    return {
      ...input,
      nextTask: input.env.runtime.createContinuationFormalConversationTask(
        input.env.task,
      ),
    };
  },
};
