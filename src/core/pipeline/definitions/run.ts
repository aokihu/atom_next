import type { TaskItem } from "@/types/task";
import {
  PipelineEventBus,
  PipelineRunner,
  type PipelineDefinition,
  type PipelineEventMap,
  type PipelineRunDeps,
} from "..";

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
