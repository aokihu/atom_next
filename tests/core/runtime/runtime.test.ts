// @ts-nocheck
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Runtime } from "@/core/runtime";
import { Transport } from "@/core/transport";
import { ServiceManager } from "@/libs/service-manage";
import { MemoryService, ToolService } from "@/services";
import { RuntimeService } from "@/services/runtime";
import { WatchmanPhase } from "@/services/watchman/types";
import { TaskSource, TaskState, type TaskItem } from "@/types/task";

const buildRuntime = () => {
  const serviceManager = new ServiceManager();
  const runtimeService = new RuntimeService();

  serviceManager.register(runtimeService);

  return new Runtime(serviceManager);
};

const workspaces: string[] = [];
const memoryServices: MemoryService[] = [];

const buildRuntimeWithServices = async () => {
  const workspace = await mkdtemp(join(tmpdir(), "atom-next-runtime-step1-"));
  workspaces.push(workspace);

  const serviceManager = new ServiceManager();
  const runtimeService = new RuntimeService();
  runtimeService.loadCliArgs({
    mode: "server",
    workspace,
    sandbox: workspace,
    serverUrl: "http://127.0.0.1:8787",
    address: "127.0.0.1",
    port: 8787,
  });
  runtimeService.loadConfig({
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
  runtimeService.syncUserAgentPromptSnapshot("", {
    phase: WatchmanPhase.READY,
    hash: null,
    updatedAt: Date.now(),
    error: null,
  });

  const memoryService = new MemoryService();
  const toolService = new ToolService();
  serviceManager.register(runtimeService, memoryService, toolService);
  await memoryService.start();
  memoryServices.push(memoryService);

  return {
    runtime: new Runtime(serviceManager),
    memoryService,
    transport: new Transport(serviceManager),
  };
};

const buildRuntimeWithToolService = async (options: {
  includeWorkspace?: boolean;
} = {}) => {
  const workspace = await mkdtemp(join(tmpdir(), "atom-next-runtime-tools-"));
  workspaces.push(workspace);

  const serviceManager = new ServiceManager();
  const runtimeService = new RuntimeService();

  runtimeService.loadCliArgs({
    mode: "server",
    ...(options.includeWorkspace === false ? {} : { workspace }),
    sandbox: workspace,
    serverUrl: "http://127.0.0.1:8787",
    address: "127.0.0.1",
    port: 8787,
  });
  runtimeService.loadConfig({
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

  const toolService = new ToolService();
  serviceManager.register(runtimeService, toolService);

  return {
    runtime: new Runtime(serviceManager),
    workspace,
  };
};

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
    priority: overrides.priority ?? 2,
    eventTarget: overrides.eventTarget ?? undefined,
    channel: overrides.channel ?? { domain: "tui" },
    payload: overrides.payload ?? [{ type: "text", data: "hello runtime" }],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...(typeof overrides.chain_round === "number"
      ? { chain_round: overrides.chain_round }
      : {}),
  } as TaskItem;
};

describe("Runtime context", () => {
  afterEach(async () => {
    await Promise.all(
      memoryServices.splice(0).map(async (memoryService) => {
        await memoryService.stop();
      }),
    );
    await Promise.all(
      workspaces.splice(0).map(async (workspace) => {
        await rm(workspace, { recursive: true, force: true });
      }),
    );
  });

  test("does not render follow up block before task is bound", async () => {
    const runtime = buildRuntime();

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain("# System 总纲");
    expect(prompt).toContain("# Intent Request 使用规范");
    expect(prompt).toContain("# Memory 使用提示词");
    expect(prompt).toContain("# FOLLOW_UP / FOLLOW_UP_WITH_TOOLS 使用规范");
    expect(prompt.indexOf("# System 总纲")).toBeLessThan(
      prompt.indexOf("# Intent Request 使用规范"),
    );
    expect(prompt.indexOf("# Intent Request 使用规范")).toBeLessThan(
      prompt.indexOf("# Memory 使用提示词"),
    );
    expect(prompt.indexOf("# Memory 使用提示词")).toBeLessThan(
      prompt.indexOf("# FOLLOW_UP / FOLLOW_UP_WITH_TOOLS 使用规范"),
    );
    expect(prompt).toContain("<<<REQUEST>>>");
    expect(prompt).toContain("<IntentPolicy>");
    expect(prompt).not.toContain("ACCEPTED_INTENT_TYPE=");
    expect(prompt).toContain("<Conversation>\nSTATE=empty\n</Conversation>");
    expect(prompt).toContain("如果问题明显属于第 2 类，必须优先按记忆规则执行");
    expect(prompt).toContain("不要跳过记忆流程，直接回答“没有找到相关记忆”或“我不记得”");
    expect(prompt).toContain("当当前轮必须依赖 Runtime(Core) 协助时");
    expect(prompt).toContain("不要先输出“我将搜索”“我已请求”这类中间态正文");
    expect(prompt).not.toContain("<FollowUp>\nCHAT_ID=");
    expect(prompt).toContain("Round = 1");
  });

  test("writes original input and empty follow up fields for external task", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      payload: [
        { type: "text", data: "line-1" },
        { type: "text", data: "line-2" },
      ],
    });

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(runtime.exportUserPrompt()).toBe("line-1\nline-2");
    expect(prompt).toContain("Session ID = session-1");
    expect(prompt).toContain("Round = 1");
    expect(prompt).toContain("<IntentPolicy>");
    expect(prompt).not.toContain("ACCEPTED_INTENT_TYPE=");
    expect(prompt).toContain("<FollowUp>");
    expect(prompt).toContain("CHAT_ID=chat-1");
    expect(prompt).toContain("CHAIN_ROUND=");
    expect(prompt).toContain("ORIGINAL_USER_INPUT<<EOF\nline-1\nline-2\nEOF");
    expect(prompt).toContain("ACCUMULATED_ASSISTANT_OUTPUT<<EOF\n\nEOF");
  });

  test("appends assistant output in order and preserves multiline content", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1");
    runtime.appendAssistantOutput("part-1\n");
    runtime.appendAssistantOutput("part-2");

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain("ACCUMULATED_ASSISTANT_OUTPUT<<EOF\npart-1\npart-2\nEOF");
  });

  test("creates tool execution context from current runtime workspace", async () => {
    const { runtime, workspace } = await buildRuntimeWithToolService();

    runtime.currentTask = buildTask("task-tools-1");

    const context = runtime.createToolExecutionContext();
    const tools = runtime.createConversationToolRegistry();

    expect(context.workspace).toBe(workspace);
    expect(Object.keys(tools)).toEqual([
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
  });

  test("throws when creating tool execution context without current task", async () => {
    const { runtime } = await buildRuntimeWithToolService();

    expect(() => {
      runtime.createToolExecutionContext();
    }).toThrow("Runtime currentTask is missing");
  });

  test("throws when runtime workspace is missing for tool execution context", async () => {
    const { runtime } = await buildRuntimeWithToolService({
      includeWorkspace: false,
    });

    runtime.currentTask = buildTask("task-tools-2");

    expect(() => {
      runtime.createToolExecutionContext();
    }).toThrow("CLI argument workspace not found");
  });

  test("executeIntentRequests writes continuation context for follow up with tools", async () => {
    const { runtime } = await buildRuntimeWithServices();

    const task = buildTask("task-follow-up-tools-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "检查当前实现" }],
    });
    runtime.currentTask = task;

    const result = await runtime.executeIntentRequests(task, [
      {
        request: "FOLLOW_UP_WITH_TOOLS",
        intent: "继续验证剩余实现",
        params: {
          sessionId: "session-1",
          chatId: "chat-1",
          summary: "已经确认 ToolService 已接入 formal conversation。",
          nextPrompt: "继续检查 FOLLOW_UP 链路是否仍能继续使用 tools。",
          avoidRepeat: "不要重复前文的 ToolService 说明。",
        },
      },
    ]);

    expect(result.status).toBe("stop");
    expect(result.nextState).toBe(TaskState.FOLLOW_UP);
    expect(result.nextTask?.source).toBe(TaskSource.INTERNAL);
    expect(result.nextTask?.payload).toEqual([]);
    expect(runtime.getContinuationContext()).toEqual({
      summary: "已经确认 ToolService 已接入 formal conversation。",
      nextPrompt: "继续检查 FOLLOW_UP 链路是否仍能继续使用 tools。",
      avoidRepeat: "不要重复前文的 ToolService 说明。",
      updatedAt: expect.any(Number),
    });

    runtime.currentTask = result.nextTask!;

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(runtime.exportUserPrompt()).toBe("");
    expect(prompt).toContain("<Continuation>");
    expect(prompt).toContain(
      "<Summary>已经确认 ToolService 已接入 formal conversation。</Summary>",
    );
    expect(prompt).toContain(
      "<NextPrompt>继续检查 FOLLOW_UP 链路是否仍能继续使用 tools。</NextPrompt>",
    );
    expect(prompt).toContain(
      "<AvoidRepeat>不要重复前文的 ToolService 说明。</AvoidRepeat>",
    );
  });

  test("clears continuation context when external task arrives", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-continuation-seed", {
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      payload: [],
    });
    runtime.setContinuationContext({
      summary: "已确认部分结果",
      nextPrompt: "继续检查 tools",
      avoidRepeat: "不要重复",
    });

    runtime.currentTask = buildTask("task-continuation-external", {
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.EXTERNAL,
      payload: [{ type: "text", data: "新的外部问题" }],
    });

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(runtime.getContinuationContext().updatedAt).toBeNull();
    expect(prompt).not.toContain("<Continuation>");
  });

  test("clears continuation context when chat or session changes", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-continuation-base", {
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      payload: [],
    });
    runtime.setContinuationContext({
      summary: "已确认部分结果",
      nextPrompt: "继续检查 tools",
      avoidRepeat: "不要重复",
    });

    runtime.currentTask = buildTask("task-continuation-chat-change", {
      sessionId: "session-1",
      chatId: "chat-2",
      source: TaskSource.INTERNAL,
      payload: [],
    });
    expect(runtime.getContinuationContext().updatedAt).toBeNull();

    runtime.setContinuationContext({
      summary: "再次写入",
      nextPrompt: "继续检查",
      avoidRepeat: "不要重复",
    });
    runtime.currentTask = buildTask("task-continuation-session-change", {
      sessionId: "session-2",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      payload: [],
    });

    expect(runtime.getContinuationContext().updatedAt).toBeNull();
  });

  test("finalizeChatTurn resolves final message and commits session continuity", async () => {
    const runtime = buildRuntime();

    const task = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "first question" }],
    });
    runtime.currentTask = task;
    runtime.appendAssistantOutput("streamed answer");

    const finalizationResult = runtime.finalizeChatTurn(task, {
      resultText: "final answer",
      visibleTextBuffer: "streamed answer",
    });

    expect(finalizationResult.finalMessage).toBe("final answer");
    expect(finalizationResult.visibleChunk).toBe("streamed answer");
    expect(finalizationResult.completedPayload.message.data).toBe(
      "final answer",
    );

    runtime.currentTask = buildTask("task-2", {
      sessionId: "session-1",
      chatId: "chat-2",
      payload: [{ type: "text", data: "second question" }],
    });

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain("<Conversation>");
    expect(prompt).toContain("LAST_USER_INPUT<<EOF\nfirst question\nEOF");
    expect(prompt).toContain("LAST_ASSISTANT_OUTPUT<<EOF\nfinal answer\nEOF");
  });

  test("keeps original input and accumulated output for internal task in same chat", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      payload: [{ type: "text", data: "original question" }],
    });
    runtime.recordMemorySearchResult("long", {
      words: "watchman",
      outputs: [
        {
          memory: {
            key: "long.note.watchman",
            text: "Watchman 不负责 Memory 持久化。",
            meta: {
              created_at: 1,
              updated_at: 2,
              score: 80,
              status: "active",
              confidence: 0.9,
              type: "note",
            },
          },
          retrieval: {
            mode: "context",
            relevance: 1,
            reason: "Loaded runtime context from search watchman",
          },
          links: [],
        },
      ],
    });
    runtime.appendAssistantOutput("existing output");

    runtime.currentTask = buildTask("task-2", {
      chainId: "task-1",
      parentId: "task-1",
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      priority: 1,
      payload: [{ type: "text", data: "continue" }],
      chain_round: 1,
    });

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(runtime.exportUserPrompt()).toBe("continue");
    expect(prompt).toContain("Round = 1");
    expect(prompt).toContain("Source = internal");
    expect(prompt).toContain("CHAT_ID=chat-1");
    expect(prompt).toContain("CHAIN_ROUND=1");
    expect(prompt).toContain("ORIGINAL_USER_INPUT<<EOF\noriginal question\nEOF");
    expect(prompt).toContain("ACCUMULATED_ASSISTANT_OUTPUT<<EOF\nexisting output\nEOF");
    expect(prompt).toContain("<Long>");
    expect(prompt).toContain("<Status>loaded</Status>");
    expect(prompt).toContain("<Query>watchman</Query>");
    expect(prompt).toContain("<Key>long.note.watchman</Key>");
    expect(prompt).toContain("Watchman 不负责 Memory 持久化。");
  });

  test("preserves session intent and memory while resetting chat follow up state", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "first question" }],
    });
    runtime.setIntentPolicy("session-1", {
      sessionId: "session-1",
      acceptedIntentType: "memory_lookup",
      preloadMemory: true,
      memoryQuery: "first question",
      allowMemorySave: false,
      maxFollowUpRounds: 2,
      promptVariant: "recall",
      predictionTrust: "high",
      reasons: ["test policy"],
    });
    runtime.recordMemorySearchResult("long", {
      words: "watchman",
      outputs: [
        {
          memory: {
            key: "long.note.watchman",
            text: "Watchman 不负责 Memory 持久化。",
            meta: {
              created_at: 1,
              updated_at: 2,
              score: 80,
              status: "active",
              confidence: 0.9,
              type: "note",
            },
          },
          retrieval: {
            mode: "context",
            relevance: 1,
            reason: "Loaded runtime context from search watchman",
          },
          links: [],
        },
        {
          memory: {
            key: "long.note.agents",
            text: "AGENTS.md 由 Watchman 负责缓存编译。",
            meta: {
              created_at: 3,
              updated_at: 4,
              score: 70,
              status: "active",
              confidence: 0.8,
              type: "note",
            },
          },
          retrieval: {
            mode: "context",
            relevance: 0.8,
            reason: "Loaded runtime context from search watchman",
          },
          links: [],
        },
      ],
    });
    runtime.appendAssistantOutput("first output");
    runtime.commitSessionTurn("first question", "first answer");

    runtime.currentTask = buildTask("task-2", {
      sessionId: "session-1",
      chatId: "chat-2",
      payload: [{ type: "text", data: "second question" }],
    });

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain("Round = 2");
    expect(prompt).toContain("CHAT_ID=chat-2");
    expect(prompt).toContain("<IntentPolicy>");
    expect(prompt).toContain("SESSION_ID=session-1");
    expect(prompt).toContain("ACCEPTED_INTENT_TYPE=memory_lookup");
    expect(prompt).toContain("PRELOAD_MEMORY=true");
    expect(prompt).toContain("MEMORY_QUERY=first question");
    expect(prompt).toContain("ORIGINAL_USER_INPUT<<EOF\nsecond question\nEOF");
    expect(prompt).toContain("ACCUMULATED_ASSISTANT_OUTPUT<<EOF\n\nEOF");
    expect(prompt).toContain("<Long>");
    expect(prompt).toContain("<Status>loaded</Status>");
    expect(prompt).toContain("<Query>watchman</Query>");
    expect(prompt).toContain("<Key>long.note.agents</Key>");
    expect(prompt).toContain("<Conversation>");
    expect(prompt).toContain("LAST_USER_INPUT<<EOF\nfirst question\nEOF");
    expect(prompt).toContain("LAST_ASSISTANT_OUTPUT<<EOF\nfirst answer\nEOF");
  });

  test("renders empty memory search state after miss", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1");
    runtime.recordMemorySearchResult("long", {
      words: "missing memory",
      outputs: [],
      reason: 'No long memory matched "missing memory"',
    });

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain("<Long>");
    expect(prompt).toContain("<Status>empty</Status>");
    expect(prompt).toContain("<Query>missing memory</Query>");
    expect(prompt).toContain('<Reason>No long memory matched "missing memory"</Reason>');
  });

  test("renders structured intent policy after resolver output is written", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      payload: [{ type: "text", data: "你有关于 AGENTS.md 的记忆吗" }],
    });
    runtime.setIntentPolicy("session-1", {
      sessionId: "session-1",
      acceptedIntentType: "memory_lookup",
      preloadMemory: true,
      memoryQuery: "AGENTS md",
      allowMemorySave: false,
      maxFollowUpRounds: 2,
      promptVariant: "recall",
      predictionTrust: "high",
      reasons: ["resolver accepted high-confidence recall"],
    });

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain("<IntentPolicy>");
    expect(prompt).toContain("SESSION_ID=session-1");
    expect(prompt).toContain("ACCEPTED_INTENT_TYPE=memory_lookup");
    expect(prompt).toContain("PRELOAD_MEMORY=true");
    expect(prompt).toContain("MEMORY_QUERY=AGENTS md");
    expect(prompt).toContain("PROMPT_VARIANT=recall");
  });

  test("prepareExecutionContext predicts intent and preloads long memory for external task", async () => {
    const { runtime, memoryService, transport } = await buildRuntimeWithServices();

    memoryService.saveMemory({
      text: "Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。",
      suggested_key: "watchman agents boundary",
      created_by: "runtime-test",
    });

    const task = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "你有 AGENTS.md 相关的记忆吗" }],
    });
    runtime.currentTask = task;

    transport.generateText = async () => {
      return [
        "TYPE=memory_lookup",
        "NEEDS_MEMORY=true",
        "NEEDS_MEMORY_SAVE=false",
        "MEMORY_QUERY=AGENTS md",
        "CONFIDENCE=0.95",
      ].join("\n");
    };

    const request = await runtime.prepareExecutionContext(task, transport);

    expect(request?.source).toBe("prediction");
    expect(request?.request).toBe("PREPARE_CONVERSATION");
    expect(request?.params.acceptedIntentType).toBe("memory_lookup");
    expect(request?.params.preloadMemory).toBe(true);
    expect(request?.params.memoryQuery).toBe("AGENTS md");
    expect(runtime.getMemoryContext("long").status).toBe("idle");
  });

  test("prepare conversation preload keeps multiple long memories in one scope", async () => {
    const { runtime, memoryService } = await buildRuntimeWithServices();

    memoryService.saveMemory({
      text: "AGENTS.md 记录了 Core 的职责边界。",
      suggested_key: "agents core boundary",
      created_by: "runtime-test",
    });
    memoryService.saveMemory({
      text: "AGENTS.md 还记录了 Runtime 和 Queue 的协作链路。",
      suggested_key: "agents runtime queue flow",
      created_by: "runtime-test",
    });

    const task = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "你有 AGENTS.md 相关的记忆吗" }],
    });
    runtime.currentTask = task;

    const result = await runtime.executeIntentRequests(task, [{
      source: "prediction",
      request: "PREPARE_CONVERSATION",
      intent: "根据当前用户输入预测结果准备正式对话。",
      params: {
        acceptedIntentType: "memory_lookup",
        preloadMemory: true,
        memoryQuery: "AGENTS md",
        allowMemorySave: false,
        maxFollowUpRounds: 2,
        promptVariant: "recall",
        predictionTrust: "high",
      },
    }]);

    expect(result.status).toBe("stop");
    expect(runtime.getMemoryContext("long").status).toBe("loaded");
    expect(runtime.getMemoryContext("long").outputs).toHaveLength(2);

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain("<Key>long.note.agents_core_boundary</Key>");
    expect(prompt).toContain("<Key>long.note.agents_runtime_queue_flow</Key>");
  });

  test("prepareExecutionContext skips prediction for internal task", async () => {
    const { runtime, transport } = await buildRuntimeWithServices();

    const task = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      payload: [{ type: "text", data: "continue" }],
      chain_round: 1,
    });
    runtime.currentTask = task;

    let called = false;
    transport.generateText = async () => {
      called = true;
      return "TYPE=memory_lookup";
    };

    const policy = await runtime.prepareExecutionContext(task, transport);

    expect(called).toBe(false);
    expect(policy).toBeNull();
    expect(runtime.getMemoryContext("long").status).toBe("idle");
  });

  test("executeIntentRequests loads memory search results before follow up continues", async () => {
    const { runtime, memoryService } = await buildRuntimeWithServices();

    memoryService.saveMemory({
      text: "Watchman 服务负责 AGENTS.md 的编译缓存，不负责 Memory 持久化。",
      suggested_key: "watchman agents boundary",
      created_by: "runtime-test",
    });

    const task = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "搜索 Watchman 相关记忆" }],
    });
    runtime.currentTask = task;

    const result = await runtime.executeIntentRequests(task, [
      {
        request: "SEARCH_MEMORY",
        intent: "搜索 Watchman 相关记忆",
        params: {
          words: "Watchman",
        },
      },
      {
        request: "FOLLOW_UP",
        intent: "基于记忆继续回答",
        params: {
          sessionId: "session-1",
          chatId: "chat-1",
        },
      },
    ]);

    expect(result.status).toBe("stop");
    expect(result.nextState).toBe(TaskState.FOLLOW_UP);
    expect(result.nextTask?.source).toBe(TaskSource.INTERNAL);
    expect(runtime.getMemoryContext("long").status).toBe("loaded");
    expect(runtime.getMemoryContext("long").query).toBe("Watchman");
  });

  test("executeIntentRequests respects search limit while storing merged memory outputs", async () => {
    const { runtime, memoryService } = await buildRuntimeWithServices();

    const code1 = memoryService.saveMemory({
      text: "Code1 是 9527。",
      suggested_key: "Code1",
      created_by: "runtime-test",
    });
    const code2 = memoryService.saveMemory({
      text: "Code2 是 2048。",
      suggested_key: "Code2",
      created_by: "runtime-test",
    });

    const task = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "搜索 Code1 和 Code2" }],
    });
    runtime.currentTask = task;

    const result = await runtime.executeIntentRequests(task, [
      {
        request: "SEARCH_MEMORY",
        intent: "搜索 Code1 和 Code2",
        params: {
          words: "Code1 Code2",
          limit: 1,
        },
      },
      {
        request: "FOLLOW_UP",
        intent: "基于记忆继续回答",
        params: {
          sessionId: "session-1",
          chatId: "chat-1",
        },
      },
    ]);

    expect(result.status).toBe("stop");
    expect(runtime.getMemoryContext("long").status).toBe("loaded");
    expect(runtime.getMemoryContext("long").outputs).toHaveLength(1);
    expect([code1.memory_key, code2.memory_key]).toContain(
      runtime.getMemoryContext("long").outputs[0]?.memory.key,
    );
  });

  test("executeIntentRequests creates closure follow up when search has no explicit follow up", async () => {
    const { runtime } = await buildRuntimeWithServices();

    const task = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "先搜索相关记忆，再回答" }],
    });
    runtime.currentTask = task;

    const result = await runtime.executeIntentRequests(task, [
      {
        request: "SEARCH_MEMORY",
        intent: "搜索默认配置",
        params: {
          words: "默认 scope",
        },
      },
    ]);

    expect(result.status).toBe("stop");
    expect(result.nextState).toBe(TaskState.FOLLOW_UP);
    expect(result.nextTask?.source).toBe(TaskSource.INTERNAL);
    expect(result.nextTask?.payload[0]?.data).toContain("本轮 SEARCH_MEMORY 已执行，但模型没有提交 FOLLOW_UP。");
  });

  test("executeIntentRequests keeps memory context in sync for save update and unload", async () => {
    const { runtime } = await buildRuntimeWithServices();

    const task = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "处理记忆" }],
    });
    runtime.currentTask = task;

    const saveResult = await runtime.executeIntentRequests(task, [
      {
        request: "SAVE_MEMORY",
        intent: "保存默认配置记忆",
        params: {
          text: "MemoryService 默认 scope 是 long。",
          scope: "long",
        },
      },
    ]);

    expect(saveResult).toEqual({
      status: "continue",
    });
    const savedMemoryKey = runtime.getMemoryContext("long").query;
    expect(runtime.getMemoryContext("long").status).toBe("loaded");
    expect(runtime.getMemoryContext("long").outputs[0]?.memory.text).toBe(
      "MemoryService 默认 scope 是 long。",
    );

    const updateResult = await runtime.executeIntentRequests(task, [
      {
        request: "UPDATE_MEMORY",
        intent: "更新默认配置记忆",
        params: {
          key: savedMemoryKey,
          text: "MemoryService 默认 scope 是 long，默认 type 是 note。",
        },
      },
    ]);

    expect(updateResult).toEqual({
      status: "continue",
    });
    expect(runtime.getMemoryContext("long").outputs[0]?.memory.text).toBe(
      "MemoryService 默认 scope 是 long，默认 type 是 note。",
    );

    const unloadResult = await runtime.executeIntentRequests(task, [
      {
        request: "UNLOAD_MEMORY",
        intent: "卸载当前记忆",
        params: {
          key: savedMemoryKey,
          reason: "answer_completed",
        },
      },
    ]);

    expect(unloadResult).toEqual({
      status: "continue",
    });
    expect(runtime.getMemoryContext("long").status).toBe("idle");
  });

  test("starts with empty session continuity when session changes", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "first question" }],
    });
    runtime.setIntentPolicy("session-1", {
      sessionId: "session-1",
      acceptedIntentType: "memory_lookup",
      preloadMemory: true,
      memoryQuery: "watchman",
      allowMemorySave: false,
      maxFollowUpRounds: 1,
      promptVariant: "recall",
      predictionTrust: "high",
      reasons: ["test policy"],
    });
    runtime.commitSessionTurn("first question", "first answer");

    runtime.currentTask = buildTask("task-2", {
      sessionId: "session-2",
      chatId: "chat-2",
      payload: [{ type: "text", data: "new session question" }],
    });

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain("Session ID = session-2");
    expect(prompt).toContain("<IntentPolicy>");
    expect(prompt).not.toContain("ACCEPTED_INTENT_TYPE=");
    expect(prompt).toContain("<Conversation>\nSTATE=empty\n</Conversation>");
    expect(prompt).toContain("<Long></Long>");
  });

  test("returns safe follow up request when runtime safety passes", () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    const result = runtime.parseIntentRequest(
      '[FOLLOW_UP, "已完成前半部分，下一轮继续补充实现步骤", sessionId=session-1;chatId=chat-1]',
    );

    expect(result.safeRequests).toEqual([{
      source: "conversation",
      request: "FOLLOW_UP",
      intent: "已完成前半部分，下一轮继续补充实现步骤",
      params: {
        sessionId: "session-1",
        chatId: "chat-1",
      },
    }]);
  });

  test("returns safe follow up with tools request when runtime safety passes", () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    const result = runtime.parseIntentRequest(
      '[FOLLOW_UP_WITH_TOOLS, "继续验证", sessionId=session-1;chatId=chat-1;summary=已确认当前结果;nextPrompt=继续检查剩余工具链路;avoidRepeat=不要重复前文]',
    );

    expect(result.safeRequests).toEqual([{
      source: "conversation",
      request: "FOLLOW_UP_WITH_TOOLS",
      intent: "继续验证",
      params: {
        sessionId: "session-1",
        chatId: "chat-1",
        summary: "已确认当前结果",
        nextPrompt: "继续检查剩余工具链路",
        avoidRepeat: "不要重复前文",
      },
    }]);
  });

  test("keeps safe request order when multiple requests pass runtime safety", () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    const result = runtime.parseIntentRequest(
      [
        '[SEARCH_MEMORY, "搜索上下文记忆", words=follow up]',
        '[FOLLOW_UP, "继续当前回答", sessionId=session-1;chatId=chat-1]',
      ].join("\n"),
    );

    expect(result.safeRequests).toEqual([
      {
        source: "conversation",
        request: "SEARCH_MEMORY",
        intent: "搜索上下文记忆",
        params: {
          words: "follow up",
        },
      },
      {
        source: "conversation",
        request: "FOLLOW_UP",
        intent: "继续当前回答",
        params: {
          sessionId: "session-1",
          chatId: "chat-1",
        },
      },
    ]);
  });

  test("returns no safe requests when runtime context is missing", () => {
    const runtime = buildRuntime();

    const result = runtime.parseIntentRequest(
      '[FOLLOW_UP, "继续当前回答", sessionId=session-1;chatId=chat-1]',
    );

    expect(result.safeRequests).toEqual([]);
    expect(result.rejectedRequests).toHaveLength(1);
    expect(result.dispatchResults).toEqual([]);
  });
});
