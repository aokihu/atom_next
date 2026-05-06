/**
 * PostFollowUp pipeline definition.
 *
 * Element chain:
 *   SyncRuntimeTask → PrepareContinuation →
 *   ApplyPostFollowUpContinuation → FinalizePostFollowUp
 */
import type {
  PipelineDefinition,
  PipelineResult,
} from "../..";
import type { PostFollowUpPipelineInput } from "./types";
import { createPostFollowUpPipelineContext } from "./context";
import { createPostFollowUpPipelineState } from "./types";
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
      context: createPostFollowUpPipelineContext(task, {
        runtime: deps.runtime,
      }),
      state: createPostFollowUpPipelineState(),
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
