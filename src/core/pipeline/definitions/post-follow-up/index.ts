import type {
  PipelineDefinition,
  PipelineResult,
} from "../..";
import { createPipelineEnv } from "../..";
import type { PostFollowUpPipelineInput } from "./types";
import { syncRuntimeTaskElement } from "@element/sync-runtime-task.element";
import { prepareContinuationElement } from "./elements/prepare-continuation.element";
import { applyPostFollowUpContinuationElement } from "./elements/apply-post-follow-up-continuation.element";
import { finalizePostFollowUpElement } from "./elements/finalize-post-follow-up.element";

export const postFollowUpPipeline: PipelineDefinition<
  PostFollowUpPipelineInput,
  PipelineResult
> = {
  name: "post-follow-up",

  createInput(task, deps) {
    return {
      env: createPipelineEnv(
        task,
        deps.taskQueue,
        deps.runtime,
      ),
    };
  },

  createPipeline() {
    return {
      name: "PostFollowUp",
      elements: [
        syncRuntimeTaskElement,
        prepareContinuationElement,
        applyPostFollowUpContinuationElement,
        finalizePostFollowUpElement,
      ],
    };
  },
};
