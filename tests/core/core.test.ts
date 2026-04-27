// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildTaskItem } from "@/libs";
import { ServiceManager } from "@/libs/service-manage";
import { ChatEvents } from "@/types/event";
import { RuntimeService, MemoryService, ToolService } from "@/services";
import { WatchmanPhase } from "@/services/watchman/types";

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
  const tools = new ToolService();
  const serviceManager = new ServiceManager();
  serviceManager.register(runtime, memory, tools);
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
    outputObject.mockClear();
    stepCountIs.mockClear();
    generateText.mockResolvedValue({
      output: {
        type: "unknown",
        topicRelation: "uncertain",
        needsMemory: false,
        needsMemorySave: false,
        memoryQuery: "",
        confidence: 0.5,
      },
    });
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
              + '[FOLLOW_UP, "基于记忆继续回答"]',
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
    const chunkEvents = [];
    const eventTarget = new EventEmitter();
    eventTarget.on(ChatEvents.CHAT_OUTPUT_UPDATED, (payload) => {
      chunkEvents.push(payload);
    });
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
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();

    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[1].system).toContain("<Long>");
    expect(streamCalls[1].system).toContain("<Status>loaded</Status>");
    expect(streamCalls[1].system).toContain("<Query>Watchman</Query>");
    expect(streamCalls[1].system).toContain("Watchman 服务不负责 Memory 持久化。");
    expect(streamCalls[1].system).toContain("<Continuation>");
    expect(streamCalls[1].prompt).toBe("");
    expect(chunkEvents.length).toBeGreaterThanOrEqual(2);
    expect(chunkEvents.map((event) => String(event.delta)).join("")).toContain(
      "先搜索。Watchman 服务不负责 Memory 持久化。",
    );
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].message.data).toBe(
      "先搜索。Watchman 服务不负责 Memory 持久化。",
    );
  });

  test("auto continues with closure follow up when search memory is missing explicit follow up", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-memory-auto-follow-up-"));
    workspaces.push(workspace);

    const { memory, serviceManager } = await buildServiceManager(workspace);
    memoryServices.push(memory);

    memory.saveMemory({
      text: "MemoryService 默认 scope 是 long，默认 type 是 note。",
      suggested_key: "memoryservice defaults",
      created_by: "core-test",
    });

    const streamCalls = [];
    const responses = [
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "我将先搜索相关长期记忆，然后基于结果回答。\n<<<REQUEST>>>\n"
              + '[SEARCH_MEMORY, "搜索默认配置", words=默认 scope]',
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text: "MemoryService 默认 scope 是 long，默认 type 是 note。",
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
      payload: [{ type: "text", data: "请先搜索默认 scope，再告诉我默认配置。" }],
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

    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[1].system).toContain("<Status>loaded</Status>");
    expect(streamCalls[1].system).toContain("<Query>默认 scope</Query>");
    expect(streamCalls[1].prompt).toContain("本轮 SEARCH_MEMORY 已执行，但模型没有提交 FOLLOW_UP");
    expect(streamCalls[1].prompt).toContain("不要再次发起 SEARCH_MEMORY 或 FOLLOW_UP");
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].message.data).toBe(
      "我将先搜索相关长期记忆，然后基于结果回答。MemoryService 默认 scope 是 long，默认 type 是 note。",
    );
  });

  test("stops repeated loaded memory search follow up after one hit", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-memory-repeat-hit-"));
    workspaces.push(workspace);

    const { memory, serviceManager } = await buildServiceManager(workspace);
    memoryServices.push(memory);

    memory.saveMemory({
      text: "MemoryService 默认 scope 是 long，默认 type 是 note。",
      suggested_key: "memoryservice defaults",
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
              + '[SEARCH_MEMORY, "搜索默认配置", words=默认 scope]'
              + "\n"
              + '[FOLLOW_UP, "基于记忆继续回答"]',
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "我先继续搜索。\n<<<REQUEST>>>\n"
              + '[SEARCH_MEMORY, "重复搜索默认配置", words=默认 scope]'
              + "\n"
              + '[FOLLOW_UP, "继续基于记忆回答"]',
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text: "MemoryService 默认 scope 是 long，默认 type 是 note。",
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
      payload: [{ type: "text", data: "请先搜索默认 scope，再回答 MemoryService 默认配置。" }],
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
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();

    expect(streamCalls).toHaveLength(3);
    expect(streamCalls[1].system).toContain("<Status>loaded</Status>");
    expect(streamCalls[1].system).toContain("<Query>默认 scope</Query>");
    expect(streamCalls[1].system).toContain("MemoryService 默认 scope 是 long");
    expect(streamCalls[2].prompt).toContain("重复搜索已被 Core 拦截");
    expect(streamCalls[2].prompt).toContain("不要再次发起 SEARCH_MEMORY 或 FOLLOW_UP");
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].message.data).toBe(
      "先搜索。我先继续搜索。MemoryService 默认 scope 是 long，默认 type 是 note。",
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
              + '[FOLLOW_UP, "继续判断是否命中"]',
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
              + '[FOLLOW_UP, "继续判断是否命中"]',
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text: "没有找到相关长期记忆记录。",
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
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();

    expect(streamCalls).toHaveLength(3);
    expect(streamCalls[1].system).toContain("<Long>");
    expect(streamCalls[1].system).toContain("<Status>empty</Status>");
    expect(streamCalls[1].system).toContain("<Query>missing</Query>");
    expect(streamCalls[1].system).toContain(
      "<Reason>No long memory matched missing</Reason>",
    );
    expect(streamCalls[2].prompt).toContain("重复搜索已被 Core 拦截");
    expect(streamCalls[2].prompt).toContain("不要再次发起 SEARCH_MEMORY 或 FOLLOW_UP");
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].message.data).toBe(
      "先搜索。没有命中任何长期记忆。没有找到相关长期记忆记录。",
    );
  });

  test("loads explicit memory by key before follow up continues", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-load-memory-"));
    workspaces.push(workspace);

    const { memory, serviceManager } = await buildServiceManager(workspace);
    memoryServices.push(memory);

    const saveResult = memory.saveMemory({
      text: "Watchman 服务负责 AGENTS.md 编译缓存，不负责 Memory 持久化。",
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
              "<<<REQUEST>>>\n"
              + `[LOAD_MEMORY, "按 key 加载记忆", key=${saveResult.memory_key}]`
              + "\n"
              + '[FOLLOW_UP, "基于已加载记忆继续回答"]',
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text: "有一条相关长期记忆：Watchman 服务负责 AGENTS.md 编译缓存，不负责 Memory 持久化。",
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
      payload: [{ type: "text", data: "请按明确 key 加载记忆后回答。" }],
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
    expect(completedEvents).toHaveLength(0);

    await core.runOnce();

    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[1].system).toContain("<Status>loaded</Status>");
    expect(streamCalls[1].system).toContain(`<Key>${saveResult.memory_key}</Key>`);
    expect(streamCalls[1].system).toContain("<Continuation>");
    expect(streamCalls[1].prompt).toBe("");
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].message.data).toBe(
      "有一条相关长期记忆：Watchman 服务负责 AGENTS.md 编译缓存，不负责 Memory 持久化。",
    );
  });

  test("predicts memory lookup intent and preloads memory before formal answer", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-intent-memory-"));
    workspaces.push(workspace);

    const { memory, serviceManager } = await buildServiceManager(workspace);
    memoryServices.push(memory);

    memory.saveMemory({
      text: "Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。",
      suggested_key: "watchman memory boundary",
      created_by: "core-test",
    });

    generateText.mockResolvedValue({
      output: {
        type: "memory_lookup",
        topicRelation: "related",
        needsMemory: true,
        needsMemorySave: false,
        memoryQuery: "AGENTS md",
        confidence: 0.96,
      },
    });

    const streamCalls = [];
    streamText.mockImplementation((options) => {
      streamCalls.push(options);

      return buildStreamResult({
        chunks: [
          {
            type: "text-delta",
            text: "有一条相关长期记忆：Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。",
            options,
          },
        ],
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
      payload: [{ type: "text", data: "你有关于 AGENTS.md 的记忆吗" }],
      eventTarget,
      channel: { domain: "tui" },
    });

    const core = new Core(serviceManager);
    await core.addTask(task);
    await core.runOnce();
    expect(streamCalls).toHaveLength(0);
    await core.runOnce();

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0].system).toContain("<IntentPolicy>");
    expect(streamCalls[0].system).toContain("ACCEPTED_INTENT_TYPE=memory_lookup");
    expect(streamCalls[0].system).toContain("PRELOAD_MEMORY=true");
    expect(streamCalls[0].system).toContain("MEMORY_QUERY=AGENTS md");
    expect(streamCalls[0].system).toContain("PROMPT_VARIANT=recall");
    expect(streamCalls[0].system).toContain("<Status>loaded</Status>");
    expect(streamCalls[0].system).toContain("Watchman 服务负责 AGENTS.md 的编译缓存");
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].message.data).toBe(
      "有一条相关长期记忆：Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。",
    );
  });

  test("falls back to unknown intent when intent prediction fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-intent-fallback-"));
    workspaces.push(workspace);

    const { serviceManager } = await buildServiceManager(workspace);

    generateText.mockRejectedValueOnce(new Error("intent model unavailable"));

    const streamCalls = [];
    streamText.mockImplementation((options) => {
      streamCalls.push(options);

      return buildStreamResult({
        chunks: [
          {
            type: "text-delta",
            text: "这是在意图预测失败后的正常回答。",
            options,
          },
        ],
      });
    });

    const completedEvents = [];
    const failedEvents = [];
    const eventTarget = new EventEmitter();
    eventTarget.on(ChatEvents.CHAT_COMPLETED, (payload) => {
      completedEvents.push(payload);
    });
    eventTarget.on(ChatEvents.CHAT_FAILED, (payload) => {
      failedEvents.push(payload);
    });

    const task = buildTaskItem({
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "随便回答一个当前问题" }],
      eventTarget,
      channel: { domain: "tui" },
    });

    const core = new Core(serviceManager);
    await core.addTask(task);
    await core.runOnce();
    expect(streamCalls).toHaveLength(0);
    await core.runOnce();

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0].system).toContain("<IntentPolicy>");
    expect(streamCalls[0].system).toContain("ACCEPTED_INTENT_TYPE=unknown");
    expect(streamCalls[0].system).toContain("PRELOAD_MEMORY=false");
    expect(streamCalls[0].system).toContain("MEMORY_QUERY=");
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].message.data).toBe(
      "这是在意图预测失败后的正常回答。",
    );
    expect(failedEvents).toHaveLength(0);
  });

  test("keeps session continuity across chats in the same session", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-session-continuity-"));
    workspaces.push(workspace);

    const { memory, serviceManager } = await buildServiceManager(workspace);
    memoryServices.push(memory);

    memory.saveMemory({
      text: "Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。",
      suggested_key: "watchman memory boundary",
      created_by: "core-test",
    });

    generateText
      .mockResolvedValueOnce({
        output: {
          type: "memory_lookup",
          topicRelation: "related",
          needsMemory: true,
          needsMemorySave: false,
          memoryQuery: "AGENTS md",
          confidence: 0.96,
        },
      })
      .mockResolvedValueOnce({
        output: {
          type: "follow_up",
          topicRelation: "related",
          needsMemory: false,
          needsMemorySave: false,
          memoryQuery: "",
          confidence: 0.88,
        },
      });

    const streamCalls = [];
    const responses = [
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "根据已有记忆，AGENTS.md 有一条相关长期记录：Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。你希望了解更多信息吗？",
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "可以继续展开：这条记忆说明 AGENTS.md 的编译缓存归 Watchman 负责，而 Memory 持久化属于独立的记忆系统职责。",
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

    const core = new Core(serviceManager);

    await core.addTask(
      buildTaskItem({
        sessionId: "session-1",
        chatId: "chat-1",
        payload: [{ type: "text", data: "你有 AGENTS.md 相关的记忆吗" }],
        eventTarget,
        channel: { domain: "tui" },
      }),
    );
    await core.runOnce();
    await core.runOnce();

    await core.addTask(
      buildTaskItem({
        sessionId: "session-1",
        chatId: "chat-2",
        payload: [{ type: "text", data: "是的" }],
        eventTarget,
        channel: { domain: "tui" },
      }),
    );
    await core.runOnce();
    await core.runOnce();

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[0].system).toContain("PROMPT_VARIANT=recall");
    expect(streamCalls[1].system).toContain("<Conversation>");
    expect(streamCalls[1].system).toContain("你有 AGENTS.md 相关的记忆吗");
    expect(streamCalls[1].system).toContain("你希望了解更多信息吗？");
    expect(streamCalls[1].system).toContain("<Status>loaded</Status>");
    expect(streamCalls[1].system).toContain("Watchman 服务负责 AGENTS.md 的编译缓存");
    expect(streamCalls[1].prompt).toBe("是的");
    expect(completedEvents).toHaveLength(2);
    expect(completedEvents[1].message.data).toBe(
      "可以继续展开：这条记忆说明 AGENTS.md 的编译缓存归 Watchman 负责，而 Memory 持久化属于独立的记忆系统职责。",
    );
  });

  test("injects continuation context into next follow up with tools and clears it after consumption", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-follow-up-tools-"));
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
              "先整理当前结果。\n<<<REQUEST>>>\n"
              + '[FOLLOW_UP_WITH_TOOLS, "继续验证", summary=已经确认 tools 已接入 formal conversation;nextPrompt=继续检查 follow-up 链路是否还能继续使用 tools;avoidRepeat=不要重复前文]',
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text: "继续验证后确认 follow-up 轮次仍然可以继续使用 tools。",
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text: "这是新的外部会话回答。",
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

    const core = new Core(serviceManager);

    await core.addTask(
      buildTaskItem({
        sessionId: "session-1",
        chatId: "chat-1",
        payload: [{ type: "text", data: "继续检查 tools 集成" }],
        eventTarget,
        channel: { domain: "tui" },
      }),
    );

    await core.runOnce();
    await core.runOnce();
    await core.runOnce();

    await core.addTask(
      buildTaskItem({
        sessionId: "session-1",
        chatId: "chat-2",
        payload: [{ type: "text", data: "新的外部问题" }],
        eventTarget,
        channel: { domain: "tui" },
      }),
    );

    await core.runOnce();
    await core.runOnce();

    expect(streamCalls).toHaveLength(3);
    expect(streamCalls[0].tools).toBeDefined();
    expect(streamCalls[1].system).toContain("<Continuation>");
    expect(streamCalls[1].system).toContain(
      "<Summary>已经确认 tools 已接入 formal conversation</Summary>",
    );
    expect(streamCalls[1].system).toContain(
      "<NextPrompt>继续检查 follow-up 链路是否还能继续使用 tools</NextPrompt>",
    );
    expect(streamCalls[1].system).toContain(
      "<AvoidRepeat>不要重复前文</AvoidRepeat>",
    );
    expect(streamCalls[1].prompt).toBe("");
    expect(streamCalls[1].tools).toBeDefined();
    expect(Object.keys(streamCalls[1].tools)).toEqual([
      "read",
      "ls",
      "tree",
      "ripgrep",
      "write",
      "cp",
      "mv",
      "bash",
      "git",
    ]);
    expect(streamCalls[2].system).not.toContain("<Continuation>");
    expect(streamCalls[2].prompt).toBe("新的外部问题");
    expect(completedEvents).toHaveLength(2);
    expect(completedEvents[0].message.data).toBe(
      "先整理当前结果。继续验证后确认 follow-up 轮次仍然可以继续使用 tools。",
    );
    expect(completedEvents[1].message.data).toBe("这是新的外部会话回答。");
  });

  test("commits final follow up answer into session continuity context", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "atom-next-core-follow-up-session-commit-"));
    workspaces.push(workspace);

    const { memory, serviceManager } = await buildServiceManager(workspace);
    memoryServices.push(memory);

    memory.saveMemory({
      text: "Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。",
      suggested_key: "watchman memory boundary",
      created_by: "core-test",
    });

    generateText
      .mockResolvedValueOnce({
        output: {
          type: "memory_lookup",
          topicRelation: "related",
          needsMemory: true,
          needsMemorySave: false,
          memoryQuery: "AGENTS md",
          confidence: 0.96,
        },
      })
      .mockResolvedValueOnce({
        output: {
          type: "follow_up",
          topicRelation: "related",
          needsMemory: false,
          needsMemorySave: false,
          memoryQuery: "",
          confidence: 0.87,
        },
      });

    const streamCalls = [];
    const responses = [
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "先搜索相关长期记忆。\n<<<REQUEST>>>\n"
              + '[SEARCH_MEMORY, "搜索 AGENTS 记忆", words=AGENTS md]'
              + "\n"
              + '[FOLLOW_UP, "基于记忆继续回答"]',
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "有一条相关长期记忆：Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。你希望了解更多信息吗？",
          },
        ],
      },
      {
        chunks: [
          {
            type: "text-delta",
            text:
              "可以继续展开：这条记忆说明 AGENTS.md 的编译缓存归 Watchman 负责，而 Memory 持久化属于独立的记忆系统职责。",
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

    const core = new Core(serviceManager);

    await core.addTask(
      buildTaskItem({
        sessionId: "session-1",
        chatId: "chat-1",
        payload: [{ type: "text", data: "你有 AGENTS.md 相关的记忆吗" }],
        eventTarget,
        channel: { domain: "tui" },
      }),
    );

    await core.runOnce();
    await core.runOnce();
    await core.runOnce();

    await core.addTask(
      buildTaskItem({
        sessionId: "session-1",
        chatId: "chat-2",
        payload: [{ type: "text", data: "是的" }],
        eventTarget,
        channel: { domain: "tui" },
      }),
    );
    await core.runOnce();
    await core.runOnce();

    expect(streamCalls).toHaveLength(3);
    expect(streamCalls[2].system).toContain("<Conversation>");
    expect(streamCalls[2].system).toContain("你有 AGENTS.md 相关的记忆吗");
    expect(streamCalls[2].system).toContain(
      "有一条相关长期记忆：Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。你希望了解更多信息吗？",
    );
    expect(completedEvents).toHaveLength(2);
    expect(completedEvents[0].message.data).toBe(
      "先搜索相关长期记忆。有一条相关长期记忆：Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。你希望了解更多信息吗？",
    );
    expect(completedEvents[1].message.data).toBe(
      "可以继续展开：这条记忆说明 AGENTS.md 的编译缓存归 Watchman 负责，而 Memory 持久化属于独立的记忆系统职责。",
    );
  });
});
