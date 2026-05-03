import type { PipelineDefinition, PipelineResult } from "..";
import { TaskWorkflow } from "@/types/task";
import { formalConversationPipeline } from "./formal-conversation";
import { postFollowUpPipeline } from "./post-follow-up";
import { userIntentPredictionPipeline } from "./user-intent-prediction";

export const PipelineRegistry = new Map<
  TaskWorkflow,
  PipelineDefinition<any, PipelineResult>
>([
  [TaskWorkflow.PREDICT_USER_INTENT, userIntentPredictionPipeline],
  [TaskWorkflow.POST_FOLLOW_UP, postFollowUpPipeline],
  [TaskWorkflow.FORMAL_CONVERSATION, formalConversationPipeline],
]);
