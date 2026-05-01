// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

import { RuntimeEventBus } from "@/core/pipeline";
import { runFormalConversationWorkflow } from "@/core/workflows/runFormalConversationWorkflow";
import { ChatEvents } from "@/types/event";
import { TaskSource, TaskState, type TaskItem } from "@/types/task";

const buildTask = (
  id: string,
  overrides: Partial<TaskItem & { chainRound?: number }> = {},
): TaskItem => {
  const now = Date.now();

  return {
    id,
    chainId: overrides.chainId ?? id,
    parentTaskId: overrides.parentTaskId ?? id,
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
    ...(typeof overrides.chainRound === "number"
      ? { chainRound: overrides.chainRound }
      : {}),
  } as TaskItem;
};

const buildUsage = () => ({
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
});

describe("runFormalConversationWorkflow", () => {
  test("uses external eventBus when provided", async () => {
    const task = buildTask("task-bus");
    const eventBus = new RuntimeEventBus();
    const events = [];
    let currentTask;
    const runtime = {
      set currentTask(nextTask) {
        currentTask = nextTask;
      },
      get currentTask() {
        return currentTask;
      },
      exportPrompts: async () => ["system prompt", "user prompt"],
      getFormalConversationMaxOutputTokens: () => 64,
      getFormalConversationMaxToolSteps: () => 2,
      createConversationToolRegistry: mock(() => ({})),
      appendAssistantOutput: mock(() => {}),
      clearContinuationContext: mock(() => {}),
      reportConversationOutputAnalysis: mock(() => {}),
      parseIntentRequest: mock(() => ({
        safeRequests: [],
      })),
      executeIntentRequests: mock(async () => ({
        status: "continue",
      })),
      finalizeChatTurn: mock(() => ({
        finalMessage: "answer",
        visibleChunk: "answer",
        completedPayload: {
          sessionId: task.sessionId,
          chatId: task.chatId,
          status: "completed",
          message: {
            createdAt: Date.now(),
            data: "answer",
          },
        },
      })),
    };
    const taskQueue = {
      updateTask: mock(() => {}),
      addTask: mock(async () => {}),
    };
    const transport = {
      send: mock(async () => ({
        text: "answer",
        intentRequestText: "",
        finishReason: "stop",
        usage: buildUsage(),
        totalUsage: buildUsage(),
        stepCount: 1,
        toolCallCount: 0,
        toolResultCount: 0,
        responseMessageCount: 1,
      })),
    };

    eventBus.onAny((event) => {
      events.push(event);
    });

    await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
      { eventBus },
    );

    expect(events.map((event) => event.type)).toEqual([
      "pipeline.started",
      "pipeline.element.started",
      "pipeline.element.completed",
      "pipeline.element.started",
      "pipeline.element.completed",
      "pipeline.element.started",
      "pipeline.element.completed",
      "pipeline.element.started",
      "pipeline.element.completed",
      "pipeline.element.started",
      "pipeline.element.completed",
      "pipeline.element.started",
      "pipeline.element.completed",
      "pipeline.completed",
      "pipeline.started",
      "pipeline.element.started",
      "pipeline.element.completed",
      "pipeline.element.started",
      "pipeline.element.completed",
      "pipeline.element.started",
      "pipeline.element.completed",
      "pipeline.element.started",
      "pipeline.element.completed",
      "pipeline.completed",
    ]);
  });

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
    const reportConversationOutputAnalysis = mock(() => {});
    const executeIntentRequests = mock(async () => ({
      status: "continue",
    }));
    const finalizeChatTurn = mock(() => ({
      finalMessage: "final answer",
      visibleChunk: "visible answer",
      completedPayload: {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: "completed",
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
      getFormalConversationMaxOutputTokens: () => 256,
      getFormalConversationMaxToolSteps: () => 10,
      createConversationToolRegistry,
      appendAssistantOutput,
      clearContinuationContext,
      reportConversationOutputAnalysis,
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
        stepCount: 1,
        toolCallCount: 0,
        toolResultCount: 0,
        responseMessageCount: 1,
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
    expect(send.mock.calls[0]?.[2]?.maxOutputTokens).toBe(256);
    expect(send.mock.calls[0]?.[2]?.maxToolSteps).toBe(10);
    expect(send.mock.calls[0]?.[2]?.tools).toBe(tools);
    expect(reportConversationOutputAnalysis).toHaveBeenCalledWith({
      finishReason: "stop",
      visibleTextCharLength: "visible answer".length,
      intentRequestText: "",
      stepCount: 1,
      toolCallCount: 0,
      toolResultCount: 0,
      responseMessageCount: 1,
    });
    expect(appendAssistantOutput).toHaveBeenCalledWith("visible answer");
    expect(clearContinuationContext).toHaveBeenCalledTimes(1);
    expect(updateTask.mock.calls).toEqual([
      [task.id, { state: TaskState.PROCESSING }, { shouldSyncEvent: false }],
      [task.id, { state: TaskState.COMPLETED }, { shouldSyncEvent: false }],
    ]);
    expect(outputUpdated).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  test("emits transport events through external eventBus", async () => {
    const task = buildTask("task-transport-events");
    const eventBus = new RuntimeEventBus();
    const events = [];
    const runtime = {
      exportPrompts: async () => ["system prompt", "user prompt"],
      getFormalConversationMaxOutputTokens: () => 64,
      getFormalConversationMaxToolSteps: () => 2,
      createConversationToolRegistry: mock(() => ({})),
      appendAssistantOutput: mock(() => {}),
      clearContinuationContext: mock(() => {}),
      reportConversationOutputAnalysis: mock(() => {}),
      reportToolCallStarted: mock(() => {}),
      reportToolCallFinished: mock(() => {}),
      parseIntentRequest: mock(() => ({
        safeRequests: [],
      })),
      executeIntentRequests: mock(async () => ({
        status: "continue",
      })),
      finalizeChatTurn: mock(() => ({
        finalMessage: "answer",
        visibleChunk: "answer",
        completedPayload: {
          sessionId: task.sessionId,
          chatId: task.chatId,
          status: "completed",
          message: {
            createdAt: Date.now(),
            data: "answer",
          },
        },
      })),
    };
    const taskQueue = {
      updateTask: mock(() => {}),
      addTask: mock(async () => {}),
    };
    const transport = {
      send: mock(async (_systemPrompt, _userPrompt, options) => {
        await options.onTextDelta?.("delta");
        await options.onToolCallStart?.({ toolName: "read", input: { path: "a" } });
        await options.onToolCallFinish?.({
          toolName: "read",
          input: { path: "a" },
          result: { ok: true },
        });

        return {
          text: "answer",
          intentRequestText: "",
          finishReason: "stop",
          usage: buildUsage(),
          totalUsage: buildUsage(),
          stepCount: 1,
          toolCallCount: 1,
          toolResultCount: 1,
          responseMessageCount: 1,
          pendingToolCalls: [],
        };
      }),
    };

    eventBus.onAny((event) => {
      events.push(event);
    });

    await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
      { eventBus },
    );

    expect(events.some((event) => event.type === "transport.delta")).toBe(true);
    expect(events.some((event) => event.type === "transport.tool.started")).toBe(
      true,
    );
    expect(events.some((event) => event.type === "transport.tool.finished")).toBe(
      true,
    );
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
    const reportConversationOutputAnalysis = mock(() => {});
    const clearContinuationContext = mock(() => {});
    const finalizeChatTurn = mock(() => ({
      finalMessage: "final answer",
      visibleChunk: "visible-1visible-2",
      completedPayload: {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: "completed",
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
      getFormalConversationMaxOutputTokens: () => 128,
      getFormalConversationMaxToolSteps: () => 10,
      createConversationToolRegistry: mock(() => tools),
      appendAssistantOutput: mock(() => {}),
      clearContinuationContext,
      reportConversationOutputAnalysis,
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
          stepCount: 2,
          toolCallCount: 1,
          toolResultCount: 1,
          responseMessageCount: 2,
        };
      }),
    };

    await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
    );

    expect(transport.send.mock.calls[0]?.[2]?.maxOutputTokens).toBe(128);
    expect(reportConversationOutputAnalysis).toHaveBeenCalledWith({
      finishReason: "stop",
      visibleTextCharLength: "visible-1visible-2".length,
      intentRequestText: "request-a",
      stepCount: 2,
      toolCallCount: 1,
      toolResultCount: 1,
      responseMessageCount: 2,
    });
    expect(parseIntentRequest).toHaveBeenCalledWith("request-a");
    expect(clearContinuationContext).toHaveBeenCalledTimes(1);
    expect(finalizeChatTurn).toHaveBeenCalledWith(task, {
      resultText: "final answer",
      visibleTextBuffer: "visible-1visible-2",
    });
  });

  test("finalizes with visible boundary message when finishReason is tool-calls without intent request", async () => {
    const task = buildTask("task-3", {
      eventTarget: new EventEmitter(),
    });

    let currentTask;
    const runtime = {
      set currentTask(nextTask) {
        currentTask = nextTask;
      },
      get currentTask() {
        return currentTask;
      },
      exportPrompts: async () => ["system prompt", "user prompt"],
      getFormalConversationMaxOutputTokens: () => 128,
      getFormalConversationMaxToolSteps: () => 10,
      createConversationToolRegistry: mock(() => ({
        read: {
          description: "read file",
          inputSchema: {},
        },
      })),
      appendAssistantOutput: mock(() => {}),
      clearContinuationContext: mock(() => {}),
      reportConversationOutputAnalysis: mock(() => {}),
      parseIntentRequest: mock(() => ({
        safeRequests: [],
      })),
      executeIntentRequests: mock(async () => ({
        status: "continue",
      })),
      reportToolCallStarted: mock(() => {}),
      reportToolCallFinished: mock(() => {}),
      finalizeChatTurn: mock((_task, options) => ({
        finalMessage: options.resultText,
        visibleChunk: options.visibleTextBuffer,
        completedPayload: {
          sessionId: task.sessionId,
          chatId: task.chatId,
          status: "completed",
          message: {
            createdAt: Date.now(),
            data: options.resultText,
          },
        },
      })),
    };

    const updateTask = mock(() => {});
    const completed = mock(() => {});
    task.eventTarget?.on(ChatEvents.CHAT_COMPLETED, completed);
    const taskQueue = {
      updateTask,
      addTask: mock(async () => {}),
    };

    const transport = {
      send: mock(async (_systemPrompt, _userPrompt, options) => {
        await options.onTextDelta?.("先看看目录结构。");

        return {
          text: "先看看目录结构。",
          intentRequestText: "",
          finishReason: "tool-calls",
          usage: buildUsage(),
          totalUsage: buildUsage(),
          stepCount: 5,
          toolCallCount: 5,
          toolResultCount: 5,
          responseMessageCount: 10,
        };
      }),
    };

    const result = await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
    );

    expect(result).toEqual({
      decision: { type: "finalize_chat" },
    });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("工具调用已完成");
    expect(updateTask.mock.calls).toEqual([
      [task.id, { state: TaskState.PROCESSING }, { shouldSyncEvent: false }],
      [task.id, { state: TaskState.COMPLETED }, { shouldSyncEvent: false }],
    ]);
  });

  test("reports tool start and finish events to runtime hooks", async () => {
    const task = buildTask("task-4", {
      eventTarget: new EventEmitter(),
    });
    const reportToolCallStarted = mock(() => {});
    const reportToolCallFinished = mock(() => {});

    let currentTask;
    const runtime = {
      set currentTask(nextTask) {
        currentTask = nextTask;
      },
      get currentTask() {
        return currentTask;
      },
      exportPrompts: async () => ["system prompt", "user prompt"],
      getFormalConversationMaxOutputTokens: () => 128,
      getFormalConversationMaxToolSteps: () => 10,
      createConversationToolRegistry: mock(() => ({
        read: {
          description: "read file",
          inputSchema: {},
        },
      })),
      appendAssistantOutput: mock(() => {}),
      clearContinuationContext: mock(() => {}),
      reportConversationOutputAnalysis: mock(() => {}),
      parseIntentRequest: mock(() => ({
        safeRequests: [],
      })),
      executeIntentRequests: mock(async () => ({
        status: "continue",
      })),
      reportToolCallStarted,
      reportToolCallFinished,
      finalizeChatTurn: mock(() => ({
        finalMessage: "done",
        visibleChunk: "done",
        completedPayload: {
          sessionId: task.sessionId,
          chatId: task.chatId,
          status: "completed",
          message: {
            createdAt: Date.now(),
            data: "done",
          },
        },
      })),
    };

    const taskQueue = {
      updateTask: mock(() => {}),
      addTask: mock(async () => {}),
    };

    const transport = {
      send: mock(async (_systemPrompt, _userPrompt, options) => {
        await options.onToolCallStart?.({
          toolName: "read",
          toolCallId: "call_1",
          input: { filepath: "/tmp/demo.txt" },
        });
        await options.onToolCallFinish?.({
          toolName: "read",
          toolCallId: "call_1",
          input: { filepath: "/tmp/demo.txt" },
          result: { filepath: "/tmp/demo.txt", content: [] },
        });

        return {
          text: "done",
          intentRequestText: "",
          finishReason: "stop",
          usage: buildUsage(),
          totalUsage: buildUsage(),
          stepCount: 1,
          toolCallCount: 1,
          toolResultCount: 1,
          responseMessageCount: 2,
        };
      }),
    };

    await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
    );

    expect(reportToolCallStarted).toHaveBeenCalledWith({
      toolName: "read",
      toolCallId: "call_1",
      input: { filepath: "/tmp/demo.txt" },
    });
    expect(reportToolCallFinished).toHaveBeenCalledWith({
      toolName: "read",
      toolCallId: "call_1",
      input: { filepath: "/tmp/demo.txt" },
      result: { filepath: "/tmp/demo.txt", content: [] },
    });
  });

  test("finalizes with visible failure message when tool call fails without visible output", async () => {
    const eventTarget = new EventEmitter();
    const outputUpdated = mock(() => {});
    const completed = mock(() => {});
    eventTarget.on(ChatEvents.CHAT_OUTPUT_UPDATED, outputUpdated);
    eventTarget.on(ChatEvents.CHAT_COMPLETED, completed);

    const task = buildTask("task-5", { eventTarget });

    let currentTask;
    const runtime = {
      set currentTask(nextTask) {
        currentTask = nextTask;
      },
      get currentTask() {
        return currentTask;
      },
      exportPrompts: async () => ["system prompt", "user prompt"],
      getFormalConversationMaxOutputTokens: () => 128,
      getFormalConversationMaxToolSteps: () => 10,
      createConversationToolRegistry: mock(() => ({
        read: {
          description: "read file",
          inputSchema: {},
        },
      })),
      appendAssistantOutput: mock(() => {}),
      clearContinuationContext: mock(() => {}),
      reportConversationOutputAnalysis: mock(() => {}),
      parseIntentRequest: mock(() => ({
        safeRequests: [],
      })),
      executeIntentRequests: mock(async () => ({
        status: "continue",
      })),
      reportToolCallStarted: mock(() => {}),
      reportToolCallFinished: mock(() => {}),
      finalizeChatTurn: mock((_task, options) => ({
        finalMessage: options.resultText,
        visibleChunk: options.visibleTextBuffer,
        completedPayload: {
          sessionId: task.sessionId,
          chatId: task.chatId,
          status: "completed",
          message: {
            createdAt: Date.now(),
            data: options.resultText,
          },
        },
      })),
    };

    const updateTask = mock(() => {});
    const taskQueue = {
      updateTask,
      addTask: mock(async () => {}),
    };

    const transport = {
      send: mock(async (_systemPrompt, _userPrompt, options) => {
        await options.onToolCallFinish?.({
          toolName: "read",
          toolCallId: "call_2",
          input: { filepath: "/tmp/missing.txt" },
          result: { error: "The file does not exist, check filepath" },
        });

        return {
          text: "",
          intentRequestText: "",
          finishReason: "tool-calls",
          usage: buildUsage(),
          totalUsage: buildUsage(),
          stepCount: 1,
          toolCallCount: 1,
          toolResultCount: 1,
          responseMessageCount: 2,
        };
      }),
    };

    const result = await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
    );

    expect(result).toEqual({
      decision: { type: "finalize_chat" },
    });
    expect(outputUpdated).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("工具调用失败");
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("The file does not exist");
    expect(updateTask.mock.calls).toEqual([
      [task.id, { state: TaskState.COMPLETED }, { shouldSyncEvent: false }],
    ]);
  });

  test("finalizes when tool-calls returns without any executed tools", async () => {
    const eventTarget = new EventEmitter();
    const completed = mock(() => {});
    eventTarget.on(ChatEvents.CHAT_COMPLETED, completed);

    const task = buildTask("task-6", {
      eventTarget,
    });

    let currentTask;
    const runtime = {
      set currentTask(nextTask) {
        currentTask = nextTask;
      },
      get currentTask() {
        return currentTask;
      },
      exportPrompts: async () => ["system prompt", ""],
      getFormalConversationMaxOutputTokens: () => 128,
      getFormalConversationMaxToolSteps: () => 10,
      createConversationToolRegistry: mock(() => ({
        ls: {
          description: "list dir",
          inputSchema: {},
        },
      })),
      appendAssistantOutput: mock(() => {}),
      clearContinuationContext: mock(() => {}),
      reportConversationOutputAnalysis: mock(() => {}),
      parseIntentRequest: mock(() => ({
        safeRequests: [],
      })),
      executeIntentRequests: mock(async () => ({
        status: "continue",
      })),
      reportToolCallStarted: mock(() => {}),
      reportToolCallFinished: mock(() => {}),
      finalizeChatTurn: mock((_task, options) => ({
        finalMessage: options.resultText,
        visibleChunk: options.visibleTextBuffer,
        completedPayload: {
          sessionId: task.sessionId,
          chatId: task.chatId,
          status: "completed",
          message: {
            createdAt: Date.now(),
            data: options.resultText,
          },
        },
      })),
    };

    const taskQueue = {
      updateTask: mock(() => {}),
      addTask: mock(async () => {}),
    };

    const transport = {
      send: mock(async () => ({
        text: "",
        intentRequestText: "",
        finishReason: "tool-calls",
        usage: buildUsage(),
        totalUsage: buildUsage(),
        stepCount: 1,
        toolCallCount: 0,
        toolResultCount: 0,
        responseMessageCount: 1,
      })),
    };

    const result = await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
    );

    expect(result).toEqual({
      decision: { type: "finalize_chat" },
    });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("没有实际执行任何工具");
  });

  test("defers completion and schedules next internal round when runtime executes pending tool calls", async () => {
    const task = buildTask("task-7");

    let currentTask;
    const nextTask = buildTask("task-7-next", {
      source: TaskSource.INTERNAL,
      sessionId: task.sessionId,
      chatId: task.chatId,
      payload: [],
    });
    const runtime = {
      set currentTask(nextTaskValue) {
        currentTask = nextTaskValue;
      },
      get currentTask() {
        return currentTask;
      },
      exportPrompts: async () => ["system prompt", "user prompt"],
      getFormalConversationMaxOutputTokens: () => 128,
      getFormalConversationMaxToolSteps: () => 10,
      createConversationToolRegistry: mock(() => ({
        read: {
          description: "read file",
          inputSchema: {},
        },
      })),
      appendAssistantOutput: mock(() => {}),
      clearContinuationContext: mock(() => {}),
      reportConversationOutputAnalysis: mock(() => {}),
      parseIntentRequest: mock(() => ({ safeRequests: [] })),
      executeIntentRequests: mock(async () => ({ status: "continue" })),
      executeConversationToolCalls: mock(async () => ({ ok: true })),
      createContinuationFormalConversationTask: mock(() => nextTask),
      finalizeChatTurn: mock(() => {
        throw new Error("should not finalize");
      }),
    };

    const updateTask = mock(() => {});
    const addTask = mock(async () => {});
    const taskQueue = {
      updateTask,
      addTask,
    };

    const transport = {
      send: mock(async () => ({
        text: "",
        intentRequestText: "",
        finishReason: "tool-calls",
        usage: buildUsage(),
        totalUsage: buildUsage(),
        stepCount: 1,
        toolCallCount: 1,
        toolResultCount: 0,
        responseMessageCount: 1,
        pendingToolCalls: [
          {
            toolName: "read",
            toolCallId: "call_1",
            input: { filepath: "/tmp/demo.txt" },
          },
        ],
      })),
    };

    const result = await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
    );

    expect(result).toEqual({
      decision: { type: "defer_completion" },
    });
    expect(runtime.executeConversationToolCalls).toHaveBeenCalledWith([
      {
        toolName: "read",
        toolCallId: "call_1",
        input: { filepath: "/tmp/demo.txt" },
      },
    ]);
    expect(updateTask).toHaveBeenCalledWith(
      task.id,
      { state: TaskState.FOLLOW_UP },
      { shouldSyncEvent: false },
    );
    expect(addTask).toHaveBeenCalledWith(nextTask);
  });

  test("finalizes with runtime tool execution failure message when pending tool call cannot be executed", async () => {
    const eventTarget = new EventEmitter();
    const completed = mock(() => {});
    eventTarget.on(ChatEvents.CHAT_COMPLETED, completed);

    const task = buildTask("task-8", { eventTarget });

    let currentTask;
    const runtime = {
      set currentTask(nextTaskValue) {
        currentTask = nextTaskValue;
      },
      get currentTask() {
        return currentTask;
      },
      exportPrompts: async () => ["system prompt", "user prompt"],
      getFormalConversationMaxOutputTokens: () => 128,
      getFormalConversationMaxToolSteps: () => 10,
      createConversationToolRegistry: mock(() => ({
        read: {
          description: "read file",
          inputSchema: {},
        },
      })),
      appendAssistantOutput: mock(() => {}),
      clearContinuationContext: mock(() => {}),
      reportConversationOutputAnalysis: mock(() => {}),
      parseIntentRequest: mock(() => ({ safeRequests: [] })),
      executeIntentRequests: mock(async () => ({ status: "continue" })),
      executeConversationToolCalls: mock(async () => ({
        ok: false,
        reasonCode: "tool_error",
        reason: "read failed",
      })),
      createContinuationFormalConversationTask: mock(() => {
        throw new Error("should not schedule next task");
      }),
      finalizeChatTurn: mock((_task, options) => ({
        finalMessage: options.resultText,
        visibleChunk: options.visibleTextBuffer,
        completedPayload: {
          sessionId: task.sessionId,
          chatId: task.chatId,
          status: "completed",
          message: {
            createdAt: Date.now(),
            data: options.resultText,
          },
        },
      })),
    };

    const taskQueue = {
      updateTask: mock(() => {}),
      addTask: mock(async () => {}),
    };

    const transport = {
      send: mock(async () => ({
        text: "",
        intentRequestText: "",
        finishReason: "tool-calls",
        usage: buildUsage(),
        totalUsage: buildUsage(),
        stepCount: 1,
        toolCallCount: 1,
        toolResultCount: 0,
        responseMessageCount: 1,
        pendingToolCalls: [
          {
            toolName: "read",
            toolCallId: "call_2",
            input: { filepath: "/tmp/demo.txt" },
          },
        ],
      })),
    };

    const result = await runFormalConversationWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      transport as any,
    );

    expect(result).toEqual({
      decision: { type: "finalize_chat" },
    });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("工具调用失败");
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("read failed");
  });
});
