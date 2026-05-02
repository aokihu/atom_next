import { ChatEvents, type ChatOutputUpdatedEventPayload } from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { TaskState } from "@/types/task";
import type { PipelineEventBus, PipelineEventMap } from "@/core/pipeline";
import type { FormalConversationWorkflowEnv, FormalConversationPipelineState } from "./types";

const emitChatOutputUpdatedEvent = (
  env: FormalConversationWorkflowEnv,
  delta: string,
): void => {
  const payload: ChatOutputUpdatedEventPayload = {
    sessionId: env.task.sessionId,
    chatId: env.task.chatId,
    status: ChatStatus.PROCESSING,
    delta,
  };

  env.task.eventTarget?.emit(ChatEvents.CHAT_OUTPUT_UPDATED, payload);
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
  env: FormalConversationWorkflowEnv,
  state: FormalConversationPipelineState,
) => {
  let hasSyncedProcessingState = false;

  const offDelta = eventBus.on("transport.delta", ({ textDelta }) => {
    if (!hasSyncedProcessingState) {
      env.taskQueue.updateTask(
        env.task.id,
        { state: TaskState.PROCESSING },
        { shouldSyncEvent: false },
      );
      hasSyncedProcessingState = true;
    }

    env.runtime.appendAssistantOutput(textDelta);
    emitChatOutputUpdatedEvent(env, textDelta);
    state.hasStreamedVisibleOutput = true;
    state.visibleTextBuffer += textDelta;
  });

  const offToolStarted = eventBus.on("transport.tool.started", (event) => {
    state.toolCallStartCount += 1;
    env.runtime.reportToolCallStarted(event);
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

    env.runtime.reportToolCallFinished(event);
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
