import type { PipelineElement } from "@/core/pipeline";
import { toPipelineResult } from "@/core/pipeline";
import type {
  UserIntentPredictionFlowState,
  RunUserIntentPredictionPipelineResult,
} from "../types";

export const finalizeUserIntentPredictionElement: PipelineElement<
  UserIntentPredictionFlowState,
  RunUserIntentPredictionPipelineResult
> = {
  name: "FinalizeUserIntentPrediction",
  kind: "sink",
  async process(input) {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("User intent prediction pipeline did not reach finalize state");
    }

    return toPipelineResult(input.finalization);
  },
};
