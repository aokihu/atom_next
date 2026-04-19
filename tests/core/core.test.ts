// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildTaskItem } from "@/libs";
import { ServiceManager } from "@/libs/service-manage";
import { ChatEvents } from "@/types/event";
import { RuntimeService, MemoryService } from "@/services";
import { WatchmanPhase } from "@/services/watchman/types";

const streamText = mock();
const generateText = mock();

mock.module("ai", () => ({
  streamText,
  generateText,
}));

const { Core } = await import("@/core/core");

const buildStreamResult = ({
  chunks = [],
  finishReason = "stop",
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
  const serviceManager = new ServiceManager();
  serviceManager.register(runtime, memory);
  await memory.start();

  return {
    runtime,
    memory,
    serviceManager,
  };
};

const workspaces: string[] = [];
const memoryServices: MemoryService[] = [];

describe("Core memory intent requests", () => {
  beforeEach(() => {
    streamText.mockReset();
    generateText.mockReset();
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

  test("loads memory into runtime context before follow up continues", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-memory-hit-"));
    workspaces.push(workspace);

    const { memory, serviceManager } = await buildServiceManager(workspace);
    memoryServices.push(memory);

    memory.saveMemory({
      text: "Watchman 服务不负责 Memory 持久化。",
      suggested_key: "watchman memory boundary",
      created_by: "core-test",
    });

    const streamCalls = [];
    const responses = [
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "先搜索。\n<<<REQUEST>>>\n"
              + '[SEARCH_MEMORY, "搜索 Watchman 相关记忆", words=Watchman]'
              + "\n"
              + '[FOLLOW_UP, "基于记忆继续回答", sessionId=session-1;chatId=chat-1]',
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text: "Watchman 服务不负责 Memory 持久化。",
          },
        ],
      },
    ];

    streamText.mockImplementation((options) => {
      streamCalls.push(options);
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

    const task = buildTaskItem({
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "先搜索相关长期记忆，再回答。" }],
      eventTarget,
      channel: { domain: "tui" },
    });

    const core = new Core(serviceManager);
    await core.addTask(task);

    await core.runOnce();
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();

    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[1].system).toContain("<Long>");
    expect(streamCalls[1].system).toContain("<Status>loaded</Status>");
    expect(streamCalls[1].system).toContain("<Query>Watchman</Query>");
    expect(streamCalls[1].system).toContain("Watchman 服务不负责 Memory 持久化。");
    expect(streamCalls[1].prompt).toBe("基于记忆继续回答");
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].message.data).toBe(
      "先搜索。Watchman 服务不负责 Memory 持久化。",
    );
  });

  test("stops repeated empty memory search follow up after one miss", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-memory-miss-"));
    workspaces.push(workspace);

    const { memory, serviceManager } = await buildServiceManager(workspace);
    memoryServices.push(memory);

    const streamCalls = [];
    const responses = [
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "先搜索。\n<<<REQUEST>>>\n"
              + '[SEARCH_MEMORY, "搜索不存在的记忆", words=missing]'
              + "\n"
              + '[FOLLOW_UP, "继续判断是否命中", sessionId=session-1;chatId=chat-1]',
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "没有命中任何长期记忆。\n<<<REQUEST>>>\n"
              + '[SEARCH_MEMORY, "重复搜索不存在的记忆", words=missing]'
              + "\n"
              + '[FOLLOW_UP, "继续判断是否命中", sessionId=session-1;chatId=chat-1]',
          },
        ],
      },
    ];

    streamText.mockImplementation((options) => {
      streamCalls.push(options);
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

    const task = buildTaskItem({
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "先搜索不存在的长期记忆，再回答。" }],
      eventTarget,
      channel: { domain: "tui" },
    });

    const core = new Core(serviceManager);
    await core.addTask(task);

    await core.runOnce();
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();

    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[1].system).toContain("<Long>");
    expect(streamCalls[1].system).toContain("<Status>empty</Status>");
    expect(streamCalls[1].system).toContain("<Query>missing</Query>");
    expect(streamCalls[1].system).toContain(
      "<Reason>No long memory matched missing</Reason>",
    );
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].message.data).toBe(
      "先搜索。没有命中任何长期记忆。",
    );
  });
});
