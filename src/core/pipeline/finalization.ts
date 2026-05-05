/**
 * Pipeline finalization helpers.
 *
 * PipelineFinalizationInput expresses a pipeline's final intent
 * (complete or enqueue) without directly constructing PipelineResult.
 *
 * toPipelineResult converts that intent into the canonical PipelineResult
 * shape consumed by Core, extracting the task from the pipeline env.
 */
import type { TaskItem } from "@/types/task";
import type { PipelineEnqueueTransition, PipelineResult } from "./types";

/**
 * Typed finalization intent produced by boundary/apply elements.
 *
 * complete = current task finished with no follow-up.
 * enqueue  = current task produced a follow-up (transition) and nextTask.
 */
export type PipelineFinalizationInput<TEnv extends { task: TaskItem }> =
  | {
      type: "complete";
      env: TEnv;
    }
  | {
      type: "enqueue";
      env: TEnv;
      transition: PipelineEnqueueTransition;
      nextTask: TaskItem;
    };

/**
 * Convert a finalization intent into a PipelineResult for Core.
 */
export const toPipelineResult = <TEnv extends { task: TaskItem }>(
  finalization: PipelineFinalizationInput<TEnv>,
): PipelineResult => {
  if (finalization.type === "complete") {
    return {
      type: "complete",
      task: finalization.env.task,
    };
  }

  return {
    type: "enqueue",
    transition: finalization.transition,
    task: finalization.env.task,
    nextTask: finalization.nextTask,
  };
};
