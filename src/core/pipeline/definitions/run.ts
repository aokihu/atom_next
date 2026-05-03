import type { TaskItem } from "@/types/task";
import { TaskPipeline } from "@/types/task";
import {
  PipelineEventBus,
  PipelineRunner,
  type PipelineDefinition,
  type PipelineEventMap,
  type PipelineResult,
  type PipelineRunDeps,
} from "..";
import { formalConversationPipeline } from "./formal-conversation";
import { postFollowUpPipeline } from "./post-follow-up";
import { userIntentPredictionPipeline } from "./user-intent-prediction";

const pipelines = {
  [TaskPipeline.FORMAL_CONVERSATION]: formalConversationPipeline,
  [TaskPipeline.POST_FOLLOW_UP]: postFollowUpPipeline,
  [TaskPipeline.PREDICT_USER_INTENT]: userIntentPredictionPipeline,
} satisfies Record<TaskPipeline, PipelineDefinition<any, PipelineResult>>;

export async function runPipeline(
  pipeline: TaskPipeline,
  task: TaskItem,
  deps: PipelineRunDeps,
  runner: PipelineRunner,
): Promise<PipelineResult> {
  const definition = pipelines[pipeline];

  if (!definition) {
    throw new Error(`Unknown pipeline: ${pipeline}`);
  }

  return runPipelineDefinition(definition, task, deps, runner);
}

export async function runPipelineDefinition<TInput, TOutput>(
  definition: PipelineDefinition<TInput, TOutput>,
  task: TaskItem,
  deps: PipelineRunDeps,
  runner: PipelineRunner,
): Promise<TOutput> {
  const eventBus = new PipelineEventBus<PipelineEventMap>();
  const input = definition.createInput(task, deps);
  const pipeline = definition.createPipeline(deps);
  const cleanup = definition.setup?.(eventBus, input, deps);

  try {
    return await runner.run(pipeline, input, {
      task,
      eventBus,
    });
  } finally {
    cleanup?.();
  }
}
