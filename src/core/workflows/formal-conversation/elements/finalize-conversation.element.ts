import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import { ChatEvents } from "@/types/event";
import { TaskState } from "@/types";
import { emitChatOutputUpdatedEvent } from "../helpers/chat-events";
import type {
  AppliedIntentRequests,
  RunFormalConversationWorkflowResult,
} from "../types";

export const finalizeConversationElement = {
  name: "formal_conversation.finalize_conversation",

  async process(
    input: AppliedIntentRequests,
    _context: PipelineContext,
  ): Promise<RunFormalConversationWorkflowResult> {
    if (input.decision.type === "defer_completion") {
      return {
        decision: input.decision,
      };
    }

    const finalizationResult = input.env.runtime.finalizeChatTurn(input.env.task, {
      resultText: input.transportResult.text,
      visibleTextBuffer: input.visibleTextBuffer,
    });

    if (!input.hasStreamedVisibleOutput && finalizationResult.visibleChunk) {
      emitChatOutputUpdatedEvent(input.env.task, finalizationResult.visibleChunk);
    }

    input.env.taskQueue.updateTask(
      input.env.task.id,
      { state: TaskState.COMPLETED },
      { shouldSyncEvent: false },
    );

    input.env.task.eventTarget?.emit(
      ChatEvents.CHAT_COMPLETED,
      finalizationResult.completedPayload,
    );

    return {
      decision: input.decision,
    };
  },
} satisfies PipelineElement<
  AppliedIntentRequests,
  RunFormalConversationWorkflowResult
>;
