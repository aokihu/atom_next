// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

import { runFormalConversationWorkflow } from "@/core/workflows/run-formal-conversation";
import { ChatEvents } from "@/types/event";
import { TaskSource, TaskState, type TaskItem } from "@/types/task";

const buildTask = (
  id: string,
  overrides: Partial<TaskItem & { chain_round?: number }> = {},
): TaskItem => {
  const now = Date.now();

  return {
    id,
    chainId: overrides.chainId ?? id,
    parentId: overrides.parentId ?? id,
    sessionId: overrides.sessionId ?? "session-1",
    chatId: overrides.chatId ?? "chat-1",
    state: overrides.state ?? TaskState.WAITING,
    source: overrides.source ?? TaskSource.EXTERNAL,
    workflow: overrides.workflow ?? "formal_conversation",
    priority: overrides.priority ?? 2,
    eventTarget: overrides.eventTarget ?? undefined,
    channel: overrides.channel ?? { domain: "tui" },
    payload: overrides.payload ?? [{ type: "text", data: "hello workflow" }],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...(typeof overrides.chain_round === "number"
      ? { chain_round: overrides.chain_round }
      : {}),
  } as TaskItem;
};

const buildUsage = () => ({
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
});

describe("runFormalConversationWorkflow", () => {
  test("injects runtime tools into transport and keeps current processing/finalize flow", async () => {
    const eventTarget = new EventEmitter();
    const outputUpdated = mock(() => {});
    const completed = mock(() => {});
    eventTarget.on(ChatEvents.CHAT_OUTPUT_UPDATED, outputUpdated);
    eventTarget.on(ChatEvents.CHAT_COMPLETED, completed);

    const task = buildTask("task-1", { eventTarget });
    const tools = {
      read: {
        description: "read file",
        inputSchema: {},
      },
    };

    const createConversationToolRegistry = mock(() => tools);
    const appendAssistantOutput = mock(() => {});
    const clearContinuationContext = mock(() => {});
    const parseIntentRequest = mock(() => ({
      safeRequests: [],
    }));
    const executeIntentRequests = mock(async () => ({
      status: "continue",
    }));
    const finalizeChatTurn = mock(() => ({
      finalMessage: "final answer",
      visibleChunk: "visible answer",
      completedPayload: {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: "complete",
        message: {
          createdAt: Date.now(),
          data: "final answer",
        },
      },
    }));

    let currentTask;
    const runtime = {
      set currentTask(nextTask) {
        currentTask = nextTask;
      },
      get currentTask() {
        return currentTask;
      },
      exportPrompts: async () => ["system prompt", "user prompt"],
      createConversationToolRegistry,
      appendAssistantOutput,
      clearContinuationContext,
      parseIntentRequest,
      executeIntentRequests,
      finalizeChatTurn,
    };

    const updateTask = mock(() => {});
    const addTask = mock(async () => {});
    const taskQueue = {
      updateTask,
      addTask,
    };

    const send = mock(async (_systemPrompt, _userPrompt, options) => {
      await options.onTextDelta?.("visible answer");

      return {
        text: "final answer",
        intentRequestText: "",
        finishReason: "stop",
        usage: buildUsage(),
        totalUsage: buildUsage(),
      };
    });
    const transport = { send };

    const result = await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
    );

    expect(result).toEqual({
      decision: { type: "finalize_chat" },
    });
    expect(createConversationToolRegistry).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[2]?.tools).toBe(tools);
    expect(appendAssistantOutput).toHaveBeenCalledWith("visible answer");
    expect(clearContinuationContext).toHaveBeenCalledTimes(1);
    expect(updateTask.mock.calls).toEqual([
      [task.id, { state: TaskState.PROCESSING }, { shouldSyncEvent: false }],
      [task.id, { state: TaskState.COMPLETE }, { shouldSyncEvent: false }],
    ]);
    expect(outputUpdated).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  test("keeps visible text buffer and intentRequestText isolated when tool loop is present", async () => {
    const task = buildTask("task-2", {
      eventTarget: new EventEmitter(),
    });
    const tools = {
      tree: {
        description: "list tree",
        inputSchema: {},
      },
    };

    const parseIntentRequest = mock(() => ({
      safeRequests: [],
    }));
    const clearContinuationContext = mock(() => {});
    const finalizeChatTurn = mock(() => ({
      finalMessage: "final answer",
      visibleChunk: "visible-1visible-2",
      completedPayload: {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: "complete",
        message: {
          createdAt: Date.now(),
          data: "final answer",
        },
      },
    }));

    let currentTask;
    const runtime = {
      set currentTask(nextTask) {
        currentTask = nextTask;
      },
      get currentTask() {
        return currentTask;
      },
      exportPrompts: async () => ["system prompt", "user prompt"],
      createConversationToolRegistry: mock(() => tools),
      appendAssistantOutput: mock(() => {}),
      clearContinuationContext,
      parseIntentRequest,
      executeIntentRequests: mock(async () => ({
        status: "continue",
      })),
      finalizeChatTurn,
    };

    const taskQueue = {
      updateTask: mock(() => {}),
      addTask: mock(async () => {}),
    };

    const transport = {
      send: mock(async (_systemPrompt, _userPrompt, options) => {
        await options.onTextDelta?.("visible-1");
        await options.onTextDelta?.("visible-2");

        return {
          text: "final answer",
          intentRequestText: "request-a",
          finishReason: "stop",
          usage: buildUsage(),
          totalUsage: buildUsage(),
        };
      }),
    };

    await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
    );

    expect(parseIntentRequest).toHaveBeenCalledWith("request-a");
    expect(clearContinuationContext).toHaveBeenCalledTimes(1);
    expect(finalizeChatTurn).toHaveBeenCalledWith(task, {
      resultText: "final answer",
      visibleTextBuffer: "visible-1visible-2",
    });
  });
});
