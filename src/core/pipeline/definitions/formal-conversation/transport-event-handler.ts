/**
 * Transport event handler for formal conversation pipeline.
 *
 * Registers handlers on the PipelineEventBus for transport.delta,
 * transport.tool.started, transport.tool.finished, and transport.failed.
 * These handlers update the pipeline state (visibleTextBuffer, tool stats)
 * in real-time as the transport element streams LLM output.
 */
import { ChatEvents, type ChatOutputUpdatedEventPayload } from "@/types/event";
import { ChatStatus } from "@/types/chat";
import type { PipelineEventBus, PipelineEventMap } from "@/core/pipeline";
import type { FormalConversationPipelineState } from "./types";
import type { FormalConversationPipelineContext } from "./context";

const emitChatOutputUpdatedEvent = (
  context: FormalConversationPipelineContext,
  delta: string,
): void => {
  const payload: ChatOutputUpdatedEventPayload = {
    sessionId: context.task.sessionId,
    chatId: context.task.chatId,
    status: ChatStatus.PROCESSING,
    delta,
  };

  context.task.eventTarget?.emit(ChatEvents.CHAT_OUTPUT_UPDATED, payload);
};

const getToolFailureMessage = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const errorValue = (value as Record<string, unknown>).error;
  return typeof errorValue === "string" && errorValue.trim() !== ""
    ? errorValue.trim()
    : undefined;
};

const stringifyToolError = (value: unknown) => {
  if (value instanceof Error) {
    return value.message;
  }

  return String(value);
};

export const registerTransportEventHandler = (
  eventBus: PipelineEventBus<PipelineEventMap>,
  context: FormalConversationPipelineContext,
  state: FormalConversationPipelineState,
) => {
  let hasSyncedProcessingState = false;

  const offDelta = eventBus.on("transport.delta", ({ textDelta }) => {
    if (!hasSyncedProcessingState) {
      context.markTaskProcessing();
      hasSyncedProcessingState = true;
    }

    context.appendAssistantOutput(textDelta);
    emitChatOutputUpdatedEvent(context, textDelta);
    state.hasStreamedVisibleOutput = true;
    state.visibleTextBuffer += textDelta;
  });

  const offToolStarted = eventBus.on("transport.tool.started", (event) => {
    state.toolCallStartCount += 1;
    context.reportToolCallStarted(event);
  });

  const offToolFinished = eventBus.on("transport.tool.finished", (event) => {
    state.toolCallFinishCount += 1;

    if ("error" in event && event.error) {
      state.toolFailureMessages.push(stringifyToolError(event.error));
    } else {
      const failureMessage = getToolFailureMessage(event.result);

      if (failureMessage) {
        state.toolFailureMessages.push(failureMessage);
      }
    }

    context.reportToolCallFinished(event);
  });

  const offFailed = eventBus.on("transport.failed", () => {
    // failure is rethrown from Transport element and handled by PipelineRunner/Core
  });

  return () => {
    offDelta();
    offToolStarted();
    offToolFinished();
    offFailed();
  };
};
