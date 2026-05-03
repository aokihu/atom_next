import type { PipelineElement } from "@/core/pipeline";
import { TaskState } from "@/types";
import type {
  PredictionExecution,
  RunUserIntentPredictionPipelineResult,
} from "../types";

export const finalizeUserIntentPredictionElement: PipelineElement<
  PredictionExecution,
  RunUserIntentPredictionPipelineResult
> = {
  name: "FinalizeUserIntentPrediction",
  kind: "sink",
  async process(input) {
    const result = input.requestExecutionResult;

    if (!result) {
      input.env.taskQueue.updateTask(
        input.env.task.id,
        { state: TaskState.COMPLETED },
        { shouldSyncEvent: false },
      );

      return {
        type: "complete",
        task: input.env.task,
      };
    }

    if (result.status === "continue") {
      input.env.taskQueue.updateTask(
        input.env.task.id,
        { state: TaskState.COMPLETED },
        { shouldSyncEvent: false },
      );

      return {
        type: "complete",
        task: input.env.task,
      };
    }

    if (result.nextState) {
      input.env.taskQueue.updateTask(
        input.env.task.id,
        { state: result.nextState },
        { shouldSyncEvent: false },
      );
    }

    if (result.nextTask) {
      return {
        type: "enqueue",
        nextTask: result.nextTask,
      };
    }

    return {
      type: "complete",
      task: input.env.task,
    };
  },
};
