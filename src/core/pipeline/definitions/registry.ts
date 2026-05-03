import type { PipelineDefinition, PipelineResult } from "..";
import { TaskPipeline } from "@/types/task";
import { formalConversationPipeline } from "./formal-conversation";
import { postFollowUpPipeline } from "./post-follow-up";
import { userIntentPredictionPipeline } from "./user-intent-prediction";

export const PipelineRegistry = new Map<
  TaskPipeline,
  PipelineDefinition<any, PipelineResult>
>([
  [TaskPipeline.PREDICT_USER_INTENT, userIntentPredictionPipeline],
  [TaskPipeline.POST_FOLLOW_UP, postFollowUpPipeline],
  [TaskPipeline.FORMAL_CONVERSATION, formalConversationPipeline],
]);
