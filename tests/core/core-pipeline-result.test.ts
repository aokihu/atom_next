// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

const { Core } = await import("@/core/core");
const { createTaskItem } = await import("@/libs/task");
const { ServiceManager } = await import("@/libs/service-manage");
const { ChatEvents } = await import("@/types/event");
const { MemoryService, RuntimeService, ToolService } = await import("@/services");
const { WatchmanPhase } = await import("@/services/watchman/types");
const { TaskWorkflow } = await import("@/types/task");

const buildStreamResult = ({
  chunks = [],
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
  usage = {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  },
  totalUsage = {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  },
} = {}) => {
  return {
    consumeStream: async () => {
      for (const chunk of chunks) {
        await chunk.options.onChunk?.({ chunk });
      }
    },
    finishReason: Promise.resolve(finishReason),
    usage: Promise.resolve(usage),
    totalUsage: Promise.resolve(totalUsage),
    steps: Promise.resolve(steps),
    response: Promise.resolve(response),
  };
};

const buildServiceManager = async (workspace: string) => {
  const runtime = new RuntimeService();
  runtime.loadCliArgs({
    mode: "server",
    workspace,
    sandbox: workspace,
    serverUrl: "http://127.0.0.1:8787",
    address: "127.0.0.1",
    port: 8787,
  });
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
  });
  runtime.syncUserAgentPromptSnapshot("", {
    phase: WatchmanPhase.READY,
    hash: null,
    updatedAt: Date.now(),
    error: null,
  });

  const memory = new MemoryService();
  const tools = new ToolService();
  const serviceManager = new ServiceManager();
  serviceManager.register(runtime, memory, tools);
  await memory.start();

  return {
    memory,
    serviceManager,
  };
};

const workspaces: string[] = [];
const memoryServices: Array<InstanceType<typeof MemoryService>> = [];

describe("Core pipeline result compatibility", () => {
  beforeEach(() => {
    streamText.mockReset();
    generateText.mockReset();
    outputObject.mockClear();
    stepCountIs.mockClear();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_COMPATIBLE_API_KEY = "test-openai-compatible-key";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  });

  afterEach(async () => {
    await Promise.all(
      memoryServices.splice(0).map(async (memory) => {
        await memory.stop();
      }),
    );
    await Promise.all(
      workspaces.splice(0).map(async (workspace) => {
        await rm(workspace, { recursive: true, force: true });
      }),
    );
  });

  test("enqueues next task without completing the current task", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-pipeline-enqueue-"));
    workspaces.push(workspace);

    const { memory, serviceManager } = await buildServiceManager(workspace);
    memoryServices.push(memory);

    const responses = [
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "我先继续处理。\n<<<REQUEST>>>\n"
              + '[FOLLOW_UP, "继续处理"]',
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text: "这是续跑后的最终答案。",
          },
        ],
      },
    ];

    streamText.mockImplementation((options) => {
      const response = responses.shift();

      return buildStreamResult({
        chunks: response.chunks.map((chunk) => ({
          ...chunk,
          options,
        })),
      });
    });

    const completedEvents = [];
    const eventTarget = new EventEmitter();
    eventTarget.on(ChatEvents.CHAT_COMPLETED, (payload) => {
      completedEvents.push(payload);
    });

    const task = createTaskItem({
      sessionId: "session-1",
      chatId: "chat-1",
      workflow: TaskWorkflow.FORMAL_CONVERSATION,
      payload: [{ type: "text", data: "继续处理当前问题" }],
      eventTarget,
      channel: { domain: "tui" },
    });

    const core = new Core(serviceManager);
    await core.addTask(task);

    await core.runOnce();
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].message.data).toBe("我先继续处理。这是续跑后的最终答案。");
  });
});
