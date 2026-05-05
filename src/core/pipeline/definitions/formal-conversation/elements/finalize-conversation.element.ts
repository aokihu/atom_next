/**
 * FinalizeConversation — terminal element for the formal conversation pipeline.
 *
 * Enqueue path: passes through the finalization intent to PipelineResult.
 * Complete path: calls runtime.finalizeChatTurn, emits final visible chunk
 * if not already streamed, emits CHAT_COMPLETED, returns PipelineResult.
 */
import type { PipelineElement, PipelineResult } from "@/core/pipeline";
import { ChatEvents, type ChatOutputUpdatedEventPayload } from "@/types/event";
import { ChatStatus } from "@/types/chat";
import type { FormalConversationFlowState } from "../types";

const emitChatOutputUpdatedEvent = (
  sessionId: string,
  chatId: string,
  eventTarget: {
    emit: (eventName: string, payload: ChatOutputUpdatedEventPayload) => void;
  } | undefined,
  delta: string,
) => {
  const payload: ChatOutputUpdatedEventPayload = {
    sessionId,
    chatId,
    status: ChatStatus.PROCESSING,
    delta,
  };

  eventTarget?.emit(ChatEvents.CHAT_OUTPUT_UPDATED, payload);
};

export const finalizeConversationElement: PipelineElement<
  FormalConversationFlowState,
  PipelineResult
> = {
  name: "FinalizeConversation",
  kind: "sink",
  async process(input) {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("Formal conversation pipeline did not reach finalize state");
    }

    if (input.finalization.type === "enqueue") {
      return {
        type: "enqueue",
        transition: input.finalization.transition,
        task: input.finalization.env.task,
        nextTask: input.finalization.nextTask,
      };
    }

    const finalizationResult = input.finalization.env.runtime.finalizeChatTurn(
      input.finalization.env.task,
      {
        resultText: input.finalization.transportResult.text,
        visibleTextBuffer: input.finalization.visibleTextBuffer,
      },
    );

    if (
      !input.finalization.hasStreamedVisibleOutput
      && finalizationResult.visibleChunk
    ) {
      emitChatOutputUpdatedEvent(
        input.finalization.env.task.sessionId,
        input.finalization.env.task.chatId,
        input.finalization.env.task.eventTarget,
        finalizationResult.visibleChunk,
      );
    }

    input.finalization.env.task.eventTarget?.emit(
      ChatEvents.CHAT_COMPLETED,
      finalizationResult.completedPayload,
    );

    return {
      type: "complete",
      task: input.finalization.env.task,
    };
  },
};
