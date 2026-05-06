/**
 * PostFollowUp pipeline types.
 *
 * PostFollowUp prepares a continuation (summary + nextPrompt + avoidRepeat)
 * before spawning the next formal conversation task.
 *
 * FlowState stages: continuation_prepared → ready_to_finalize.
 */
import type {
  PipelineResult,
} from "@/core/pipeline";
import type { TaskItem } from "@/types/task";
import type { PostFollowUpPipelineContext } from "./context";

export type PostFollowUpPipelineState = Record<string, never>;

export type PostFollowUpPipelineInput = {
  context: PostFollowUpPipelineContext;
  state: PostFollowUpPipelineState;
};

export type PostFollowUpFinalizationInput =
  | {
      type: "complete";
      context: PostFollowUpPipelineContext;
    }
  | {
      type: "enqueue";
      context: PostFollowUpPipelineContext;
      transition: "dispatch";
      nextTask: TaskItem;
    };

export type PostFollowUpFlowState =
  | {
      mode: "continuation_prepared";
      context: PostFollowUpPipelineContext;
      state: PostFollowUpPipelineState;
      nextTask: ReturnType<
        import("@/core/runtime").Runtime["createContinuationFormalConversationTask"]
      >;
    }
  | {
      mode: "ready_to_finalize";
      finalization: PostFollowUpFinalizationInput;
    };

export type RunPostFollowUpPipelineResult = PipelineResult;

export const createPostFollowUpPipelineState = (): PostFollowUpPipelineState => {
  return {};
};
