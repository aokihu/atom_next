import type { RuntimePipelineEvent, RuntimeEventBus } from "@/core/pipeline";
import { TaskState } from "@/types";
import { emitChatOutputUpdatedEvent } from "./helpers/chat-events";
import {
  getToolFailureMessage,
  stringifyToolError,
} from "./helpers/tool-errors";
import type {
  FormalConversationPipelineState,
  FormalConversationWorkflowEnv,
} from "./types";

const isTransportEvent = (
  event: RuntimePipelineEvent,
): event is Extract<RuntimePipelineEvent, { type: `transport.${string}` }> => {
  return event.type.startsWith("transport.");
};

const isTransportToolStartEvent = (
  value: unknown,
): value is {
  toolName: string;
  toolCallId?: string;
  input: unknown;
} => {
  return (
    typeof value === "object"
    && value !== null
    && "toolName" in value
    && typeof value.toolName === "string"
    && "input" in value
  );
};

const isTransportToolFinishEvent = (
  value: unknown,
): value is {
  toolName: string;
  toolCallId?: string;
  input: unknown;
  result?: unknown;
  error?: unknown;
} => {
  return isTransportToolStartEvent(value);
};

export const handleFormalConversationTransportEvent = (
  event: Extract<RuntimePipelineEvent, { type: `transport.${string}` }>,
  env: FormalConversationWorkflowEnv,
  state: FormalConversationPipelineState,
) => {
  if (event.type === "transport.delta") {
    if (!state.hasStreamedVisibleOutput) {
      env.taskQueue.updateTask(
        env.task.id,
        { state: TaskState.PROCESSING },
        { shouldSyncEvent: false },
      );
    }

    env.runtime.appendAssistantOutput(event.delta);
    emitChatOutputUpdatedEvent(env.task, event.delta);
    state.visibleTextBuffer += event.delta;
    state.hasStreamedVisibleOutput = true;
    return;
  }

  if (event.type === "transport.tool.started") {
    state.toolCallStartCount += 1;

    if (isTransportToolStartEvent(event.event)) {
      env.runtime.reportToolCallStarted(event.event);
    }

    return;
  }

  if (event.type === "transport.tool.finished") {
    state.toolCallFinishCount += 1;

    if (
      typeof event.event === "object"
      && event.event
      && "error" in event.event
      && event.event.error
    ) {
      state.toolFailureMessages.push(stringifyToolError(event.event.error));
    } else {
      const result =
        typeof event.event === "object"
        && event.event
        && "result" in event.event
          ? event.event.result
          : undefined;
      const failureMessage = getToolFailureMessage(result);

      if (failureMessage) {
        state.toolFailureMessages.push(failureMessage);
      }
    }

    if (isTransportToolFinishEvent(event.event)) {
      env.runtime.reportToolCallFinished(event.event);
    }
  }
};

export const subscribeFormalConversationTransportEvents = (
  eventBus: RuntimeEventBus,
  env: FormalConversationWorkflowEnv,
  state: FormalConversationPipelineState,
) => {
  return eventBus.onAny((event) => {
    if (isTransportEvent(event)) {
      handleFormalConversationTransportEvent(event, env, state);
    }
  });
};
