import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import { TaskState } from "@/types";
import {
  buildToolExecutionFailureResult,
  continueToIntentRequests,
  resolveToolBoundary,
  shouldExecutePendingToolCalls,
} from "../helpers/tool-boundary";
import type {
  FormalConversationTransportOutput,
  ToolBoundaryResolution,
} from "../types";

export const handleToolBoundaryElement = {
  name: "formal_conversation.handle_tool_boundary",

  async process(
    input: FormalConversationTransportOutput,
    _context: PipelineContext,
  ): Promise<ToolBoundaryResolution> {
    if (!shouldExecutePendingToolCalls(input)) {
      return continueToIntentRequests(input);
    }

    const toolExecutionResult =
      await input.env.runtime.executeConversationToolCalls(
        input.transportResult.pendingToolCalls ?? [],
      );

    if (!toolExecutionResult.ok) {
      return resolveToolBoundary(
        buildToolExecutionFailureResult(input, toolExecutionResult.reason),
      );
    }

    input.env.taskQueue.updateTask(
      input.env.task.id,
      { state: TaskState.FOLLOW_UP },
      { shouldSyncEvent: false },
    );
    await input.env.taskQueue.addTask(
      input.env.runtime.createContinuationFormalConversationTask(input.env.task),
    );

    return resolveToolBoundary({
      env: input.env,
      transportResult: input.transportResult,
      visibleTextBuffer: input.visibleTextBuffer,
      hasStreamedVisibleOutput: input.hasStreamedVisibleOutput,
      decision: { type: "defer_completion" },
    });
  },
} satisfies PipelineElement<
  FormalConversationTransportOutput,
  ToolBoundaryResolution
>;
