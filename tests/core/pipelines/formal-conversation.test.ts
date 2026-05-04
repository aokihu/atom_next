// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

const streamText = mock();
const generateText = mock();
const outputObject = mock((options) => ({
  type: "object",
  ...options,
}));
const stepCountIs = mock((stepCount) => ({
  type: "step-count",
  stepCount,
}));

mock.module("ai", () => ({
  streamText,
  generateText,
  Output: {
    object: outputObject,
  },
  stepCountIs,
}));

import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";
import { formalConversationPipeline, runPipelineDefinition } from "@/core/pipeline/definitions";
import { PipelineRunner } from "@/core/pipeline";
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
    pipeline: overrides.pipeline ?? "formal_conversation",
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

const buildServiceManager = (config = {}) => {
  const runtime = new RuntimeService();
  runtime.loadConfig({
    version: 2,
    providerProfiles: {
      advanced: "deepseek/deepseek-chat",
      balanced: "deepseek/deepseek-chat",
      basic: "deepseek/deepseek-chat",
    },
    providers: {},
    gateway: {
      enable: false,
      channels: [],
    },
    ...config,
  });

  const serviceManager = new ServiceManager();
  serviceManager.register(runtime);

  return serviceManager;
};

const buildStreamResult = ({
  consume = async () => {},
  finishReason = "stop",
  steps = [
    {
      toolCalls: [],
      toolResults: [],
    },
  ],
  response = {
    messages: [],
  },
  usage = buildUsage(),
  totalUsage = buildUsage(),
} = {}) => {
  return {
    consumeStream: async () => {
      await consume();
    },
    finishReason: Promise.resolve(finishReason),
    usage: Promise.resolve(usage),
    totalUsage: Promise.resolve(totalUsage),
    steps: Promise.resolve(steps),
    response: Promise.resolve(response),
  };
};

describe("formalConversationPipeline", () => {
  beforeEach(() => {
    streamText.mockReset();
    generateText.mockReset();
    outputObject.mockClear();
    stepCountIs.mockClear();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_COMPATIBLE_API_KEY = "test-openai-compatible-key";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
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
    const taskQueue = {
      updateTask,
      addTask: mock(async () => {}),
    };

    streamText.mockImplementation((options) => {
      return buildStreamResult({
        consume: async () => {
          await options.onChunk?.({
            chunk: { type: "text-delta", text: "visible answer" },
          });
        },
        response: {
          messages: [{ role: "assistant" }],
        },
      });
    });

    const result = await runPipelineDefinition(
      formalConversationPipeline,
      task,
      { taskQueue, runtime, serviceManager: buildServiceManager() },
      new PipelineRunner(),
    );

    expect(result).toEqual({
      type: "complete",
      task,
    });
    expect(createConversationToolRegistry).toHaveBeenCalledTimes(1);
    expect(stepCountIs).toHaveBeenCalledWith(10);
    expect(reportConversationOutputAnalysis).toHaveBeenCalledWith({
      finishReason: "stop",
      visibleTextCharLength: "visible answer".length,
      intentRequestText: "",
      stepCount: 1,
      toolCallCount: 0,
      toolResultCount: 0,
      responseMessageCount: 1,
    });
    expect(
      appendAssistantOutput.mock.calls.map(([textDelta]) => textDelta).join(""),
    ).toBe("visible answer");
    expect(clearContinuationContext).toHaveBeenCalledTimes(1);
    expect(updateTask.mock.calls).toEqual([
      [task.id, { state: TaskState.PROCESSING }, { shouldSyncEvent: false }],
    ]);
    expect(outputUpdated.mock.calls.length).toBeGreaterThan(0);
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

    streamText.mockImplementation((options) => {
      return buildStreamResult({
        consume: async () => {
          await options.onChunk?.({
            chunk: { type: "text-delta", text: "visible-1" },
          });
          await options.onChunk?.({
            chunk: {
              type: "text-delta",
              text: "visible-2\n<<<REQUEST>>>\nrequest-a",
            },
          });
        },
        steps: [
          {
            toolCalls: [{ toolName: "tree" }],
            toolResults: [{ toolName: "tree" }],
          },
          {
            toolCalls: [],
            toolResults: [],
          },
        ],
        response: {
          messages: [{ role: "assistant" }, { role: "tool" }],
        },
      });
    });

    await runPipelineDefinition(
      formalConversationPipeline,
      task,
      { taskQueue, runtime, serviceManager: buildServiceManager() },
      new PipelineRunner(),
    );

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
      resultText: "visible-1visible-2",
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

    streamText.mockImplementation((options) => {
      return buildStreamResult({
        consume: async () => {
          await options.onChunk?.({
            chunk: { type: "text-delta", text: "先看看目录结构。" },
          });
        },
        finishReason: "tool-calls",
        steps: [
          {
            toolCalls: new Array(5).fill(null).map(() => ({ toolName: "read" })),
            toolResults: new Array(5).fill(null).map(() => ({ toolName: "read" })),
          },
          {
            toolCalls: [],
            toolResults: [],
          },
        ],
        response: {
          messages: new Array(10).fill({ role: "assistant" }),
        },
      });
    });

    const result = await runPipelineDefinition(
      formalConversationPipeline,
      task,
      { taskQueue, runtime, serviceManager: buildServiceManager() },
      new PipelineRunner(),
    );

    expect(result).toEqual({
      type: "complete",
      task,
    });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("工具调用已完成");
    expect(updateTask.mock.calls).toEqual([
      [task.id, { state: TaskState.PROCESSING }, { shouldSyncEvent: false }],
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

    streamText.mockImplementation((options) => {
      return buildStreamResult({
        consume: async () => {
          await options.experimental_onToolCallStart?.({
            toolCall: {
              toolName: "read",
              toolCallId: "call_1",
              input: { filepath: "/tmp/demo.txt" },
            },
          });
          await options.experimental_onToolCallFinish?.({
            toolCall: {
              toolName: "read",
              toolCallId: "call_1",
              input: { filepath: "/tmp/demo.txt" },
            },
            success: true,
            output: { filepath: "/tmp/demo.txt", content: [] },
          });
        },
        steps: [
          {
            toolCalls: [{ toolName: "read" }],
            toolResults: [{ toolName: "read" }],
          },
        ],
        response: {
          messages: [{ role: "assistant" }, { role: "tool" }],
        },
      });
    });

    await runPipelineDefinition(
      formalConversationPipeline,
      task,
      { taskQueue, runtime, serviceManager: buildServiceManager() },
      new PipelineRunner(),
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

    streamText.mockImplementation((options) => {
      return buildStreamResult({
        consume: async () => {
          await options.experimental_onToolCallFinish?.({
            toolCall: {
              toolName: "read",
              toolCallId: "call_2",
              input: { filepath: "/tmp/missing.txt" },
            },
            success: true,
            output: { error: "The file does not exist, check filepath" },
          });
        },
        finishReason: "tool-calls",
        steps: [
          {
            toolCalls: [{ toolName: "read" }],
            toolResults: [{ toolName: "read" }],
          },
          {
            toolCalls: [],
            toolResults: [],
          },
        ],
        response: {
          messages: [{ role: "assistant" }, { role: "tool" }],
        },
      });
    });

    const result = await runPipelineDefinition(
      formalConversationPipeline,
      task,
      { taskQueue, runtime, serviceManager: buildServiceManager() },
      new PipelineRunner(),
    );

    expect(result).toEqual({
      type: "complete",
      task,
    });
    expect(outputUpdated).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("工具调用失败");
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("The file does not exist");
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

    streamText.mockImplementation(() => {
      return buildStreamResult({
        finishReason: "tool-calls",
        steps: [
          {
            toolCalls: [],
            toolResults: [],
          },
        ],
        response: {
          messages: [{ role: "assistant" }],
        },
      });
    });

    const result = await runPipelineDefinition(
      formalConversationPipeline,
      task,
      { taskQueue, runtime, serviceManager: buildServiceManager() },
      new PipelineRunner(),
    );

    expect(result).toEqual({
      type: "complete",
      task,
    });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("没有实际执行任何工具");
  });

  test("enqueues next internal round when runtime executes pending tool calls", async () => {
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
    const taskQueue = {
      updateTask,
      addTask: mock(async () => {}),
    };

    streamText.mockImplementation(() => {
      return buildStreamResult({
        finishReason: "tool-calls",
        steps: [
          {
            toolCalls: [
              {
                toolName: "read",
                toolCallId: "call_1",
                input: { filepath: "/tmp/demo.txt" },
              },
            ],
            toolResults: [],
          },
        ],
        response: {
          messages: [{ role: "assistant" }],
        },
      });
    });

    const result = await runPipelineDefinition(
      formalConversationPipeline,
      task,
      { taskQueue, runtime, serviceManager: buildServiceManager() },
      new PipelineRunner(),
    );

    expect(result).toEqual({
      type: "enqueue",
      transition: "follow_up",
      task,
      nextTask,
    });
    expect(runtime.executeConversationToolCalls).toHaveBeenCalledWith([
      {
        toolName: "read",
        toolCallId: "call_1",
        input: { filepath: "/tmp/demo.txt" },
      },
    ]);
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

    streamText.mockImplementation(() => {
      return buildStreamResult({
        finishReason: "tool-calls",
        steps: [
          {
            toolCalls: [
              {
                toolName: "read",
                toolCallId: "call_2",
                input: { filepath: "/tmp/demo.txt" },
              },
            ],
            toolResults: [],
          },
        ],
        response: {
          messages: [{ role: "assistant" }],
        },
      });
    });

    const result = await runPipelineDefinition(
      formalConversationPipeline,
      task,
      { taskQueue, runtime, serviceManager: buildServiceManager() },
      new PipelineRunner(),
    );

    expect(result).toEqual({
      type: "complete",
      task,
    });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("工具调用失败");
    expect(completed.mock.calls[0]?.[0]?.message.data).toContain("read failed");
  });
});
