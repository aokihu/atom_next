import type { PipelineElement } from "@/core/pipeline";
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
      return {
        type: "complete",
        task: input.env.task,
      };
    }

    if (result.status === "continue") {
      return {
        type: "complete",
        task: input.env.task,
      };
    }

    if (result.nextTask) {
      return {
        type: "enqueue",
        transition: "dispatch",
        task: input.env.task,
        nextTask: result.nextTask,
      };
    }

    return {
      type: "complete",
      task: input.env.task,
    };
  },
};
