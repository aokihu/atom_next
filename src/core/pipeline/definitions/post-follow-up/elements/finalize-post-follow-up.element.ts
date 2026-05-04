import type { PipelineElement } from "@/core/pipeline";
import { toPipelineResult } from "@/core/pipeline";
import type {
  PostFollowUpFlowState,
  RunPostFollowUpPipelineResult,
} from "../types";

export const finalizePostFollowUpElement: PipelineElement<
  PostFollowUpFlowState,
  RunPostFollowUpPipelineResult
> = {
  name: "FinalizePostFollowUp",
  kind: "sink",
  async process(input) {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("Post follow-up pipeline did not reach finalize state");
    }

    return toPipelineResult(input.finalization);
  },
};
