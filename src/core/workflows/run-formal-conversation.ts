import type { TaskItem } from "@/types/task";
import { ChatEvents, type ChatChunkAppendedEventPayload } from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { TaskState } from "@/types";
import { promiseChain } from "radashi";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";
import type { Transport } from "../transport";

type FormalConversationWorkflowDecision =
  | { type: "finalize_chat" }
  | { type: "defer_completion" };

type RunFormalConversationWorkflowContext = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
  transport: Transport;
  hasSyncedProcessingState: boolean;
  visibleTextBuffer: string;
  systemPrompt: string;
  userPrompt: string;
  transportResult?: Awaited<ReturnType<Transport["send"]>>;
  intentRequestResult?: ReturnType<Runtime["parseLLMRequest"]>;
  requestExecutionResult?: Awaited<
    ReturnType<Runtime["executeIntentRequests"]>
  >;
  decision: FormalConversationWorkflowDecision;
};

const createRunFormalConversationWorkflowContext = (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  transport: Transport,
): RunFormalConversationWorkflowContext => {
  return {
    task,
    taskQueue,
    runtime,
    transport,
    hasSyncedProcessingState: false,
    visibleTextBuffer: "",
    systemPrompt: "",
    userPrompt: "",
    decision: { type: "finalize_chat" },
  };
};

const syncRuntimeTask = async (
  context: RunFormalConversationWorkflowContext,
) => {
  context.runtime.currentTask = context.task;
  return context;
};

const syncTaskProcessingState = (
  context: RunFormalConversationWorkflowContext,
) => {
  if (context.hasSyncedProcessingState) {
    return;
  }

  context.taskQueue.updateTask(
    context.task.id,
    {
      state: TaskState.PROCESSING,
    },
    {
      shouldSyncEvent: false,
    },
  );

  context.hasSyncedProcessingState = true;
};

const emitChatChunkAppendedEvent = (task: TaskItem, textDelta: string) => {
  const payload: ChatChunkAppendedEventPayload = {
    sessionId: task.sessionId,
    chatId: task.chatId,
    status: ChatStatus.PROCESSING,
    chunk: textDelta,
  };

  task.eventTarget?.emit(ChatEvents.CHAT_CHUNK_APPENDED, payload);
};

const exportPrompts = async (context: RunFormalConversationWorkflowContext) => {
  const [systemPrompt, userPrompt] = await context.runtime.exportPrompts();

  context.systemPrompt = systemPrompt;
  context.userPrompt = userPrompt;

  return context;
};

const sendConversation = async (
  context: RunFormalConversationWorkflowContext,
) => {
  context.transportResult = await context.transport.send(
    context.systemPrompt,
    context.userPrompt,
    {
      onTextDelta: (textDelta) => {
        syncTaskProcessingState(context);
        context.runtime.appendAssistantOutput(textDelta);
        context.visibleTextBuffer += textDelta;
      },
    },
  );

  return context;
};

const parseIntentRequests = async (
  context: RunFormalConversationWorkflowContext,
) => {
  context.intentRequestResult = context.runtime.parseLLMRequest(
    context.transportResult?.intentRequestText ?? "",
  );

  return context;
};

const executeIntentRequests = async (
  context: RunFormalConversationWorkflowContext,
) => {
  context.requestExecutionResult = await context.runtime.executeIntentRequests(
    context.task,
    context.intentRequestResult?.safeRequests ?? [],
  );

  return context;
};

const applyIntentRequestExecution = async (
  context: RunFormalConversationWorkflowContext,
) => {
  if (!context.requestExecutionResult) {
    return context;
  }

  if (context.requestExecutionResult.status === "continue") {
    context.decision = { type: "finalize_chat" };
    return context;
  }

  if (context.requestExecutionResult.nextState) {
    context.taskQueue.updateTask(
      context.task.id,
      { state: context.requestExecutionResult.nextState },
      { shouldSyncEvent: false },
    );
  }

  if (context.requestExecutionResult.nextTask) {
    await context.taskQueue.addTask(context.requestExecutionResult.nextTask);
  }

  context.decision = { type: "defer_completion" };
  return context;
};

const finalizeConversation = async (
  context: RunFormalConversationWorkflowContext,
) => {
  if (
    context.decision.type === "defer_completion" ||
    !context.transportResult
  ) {
    return context;
  }

  const finalizationResult = context.runtime.finalizeChatTurn(context.task, {
    resultText: context.transportResult.text,
    visibleTextBuffer: context.visibleTextBuffer,
  });

  if (finalizationResult.visibleChunk) {
    emitChatChunkAppendedEvent(context.task, finalizationResult.visibleChunk);
  }

  context.taskQueue.updateTask(
    context.task.id,
    { state: TaskState.COMPLETE },
    { shouldSyncEvent: false },
  );

  context.task.eventTarget?.emit(
    ChatEvents.CHAT_COMPLETED,
    finalizationResult.completedPayload,
  );

  return context;
};

export type RunFormalConversationWorkflowResult = {
  decision: FormalConversationWorkflowDecision;
};

export const runFormalConversationWorkflow = async (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  transport: Transport,
) => {
  return promiseChain(
    syncRuntimeTask,
    exportPrompts,
    sendConversation,
    parseIntentRequests,
    executeIntentRequests,
    applyIntentRequestExecution,
    finalizeConversation,
  )(
    createRunFormalConversationWorkflowContext(
      task,
      taskQueue,
      runtime,
      transport,
    ),
  ).then((context): RunFormalConversationWorkflowResult => {
    return {
      decision: context.decision,
    };
  });
};
