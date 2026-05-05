/**
 * PostFollowUp pipeline types.
 *
 * PostFollowUp prepares a continuation (summary + nextPrompt + avoidRepeat)
 * before spawning the next formal conversation task.
 *
 * FlowState stages: continuation_prepared → ready_to_finalize.
 */
import type {
  PipelineEnv,
  PipelineFinalizationInput,
  PipelineResult,
} from "@/core/pipeline";

export type PostFollowUpPipelineEnv = PipelineEnv;

export type PostFollowUpPipelineInput = {
  env: PostFollowUpPipelineEnv;
};

export type PostFollowUpFinalizationInput =
  PipelineFinalizationInput<PostFollowUpPipelineEnv>;

export type PostFollowUpFlowState =
  | {
      mode: "continuation_prepared";
      env: PostFollowUpPipelineEnv;
      nextTask: ReturnType<
        import("@/core/runtime").Runtime["createContinuationFormalConversationTask"]
      >;
    }
  | {
      mode: "ready_to_finalize";
      finalization: PostFollowUpFinalizationInput;
    };

export type RunPostFollowUpPipelineResult = PipelineResult;
