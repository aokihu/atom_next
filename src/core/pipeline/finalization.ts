import type { TaskItem } from "@/types/task";
import type { PipelineEnqueueTransition, PipelineResult } from "./types";

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
