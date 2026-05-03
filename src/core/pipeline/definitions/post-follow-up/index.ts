import type {
  PipelineDefinition,
  PipelineResult,
} from "../..";
import type {
  PostFollowUpPipelineInput,
  RunPostFollowUpPipelineResult,
} from "./types";
import { createPostFollowUpPipelineEnv } from "./types";
import { syncRuntimeTaskElement } from "./elements/sync-runtime-task.element";
import { prepareContinuationElement } from "./elements/prepare-continuation.element";
import { finalizePostFollowUpElement } from "./elements/finalize-post-follow-up.element";

export const postFollowUpPipeline: PipelineDefinition<
  PostFollowUpPipelineInput,
  PipelineResult
> = {
  name: "post-follow-up",

  createInput(task, deps) {
    return {
      env: createPostFollowUpPipelineEnv(
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
        finalizePostFollowUpElement,
      ],
    };
  },
};

export type { RunPostFollowUpPipelineResult };
