import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import type {
  AppliedIntentRequests,
  ExecutedIntentRequests,
} from "../types";
import {
  buildToolLoopTerminationResult,
  shouldFinalizeToolCallBoundary,
} from "../helpers/tool-boundary";

export const applyIntentRequestExecutionElement = {
  name: "formal_conversation.apply_intent_request_execution",

  async process(
    input: ExecutedIntentRequests,
    _context: PipelineContext,
  ): Promise<AppliedIntentRequests> {
    if (shouldFinalizeToolCallBoundary(input)) {
      return buildToolLoopTerminationResult(input);
    }

    if (input.requestExecutionResult.status === "continue") {
      return {
        env: input.env,
        transportResult: input.transportResult,
        visibleTextBuffer: input.visibleTextBuffer,
        hasStreamedVisibleOutput: input.hasStreamedVisibleOutput,
        decision: { type: "finalize_chat" },
      };
    }

    if (input.requestExecutionResult.nextState) {
      input.env.taskQueue.updateTask(
        input.env.task.id,
        { state: input.requestExecutionResult.nextState },
        { shouldSyncEvent: false },
      );
    }

    if (input.requestExecutionResult.nextTask) {
      await input.env.taskQueue.addTask(input.requestExecutionResult.nextTask);
    }

    return {
      env: input.env,
      transportResult: input.transportResult,
      visibleTextBuffer: input.visibleTextBuffer,
      hasStreamedVisibleOutput: input.hasStreamedVisibleOutput,
      decision: { type: "defer_completion" },
    };
  },
} satisfies PipelineElement<ExecutedIntentRequests, AppliedIntentRequests>;
