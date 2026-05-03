// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const streamText = mock();
const generateText = mock();
const outputObject = mock((options) => ({
  type: "object",
  ...options,
}));

mock.module("ai", () => ({
  streamText,
  generateText,
  Output: {
    object: outputObject,
  },
  stepCountIs: mock(),
}));

import { Runtime } from "@/core/runtime";
import { ServiceManager } from "@/libs/service-manage";
import { MemoryService, ToolService } from "@/services";
import { RuntimeService } from "@/services/runtime";
import { WatchmanPhase } from "@/services/watchman/types";
import { TaskSource, TaskState, type TaskItem } from "@/types/task";

const buildRuntime = () => {
  const serviceManager = new ServiceManager();
  const runtimeService = new RuntimeService();
  runtimeService.loadConfig({
    version: 2,
    providerProfiles: {
      advanced: "deepseek/deepseek-chat",
      balanced: "deepseek/deepseek-chat",
      basic: "deepseek/deepseek-chat",
    },
    providers: {},
    transport: {
      formalConversationMaxOutputTokens: 2000,
    },
    gateway: {
      enable: false,
      channels: [],
    },
  });

  serviceManager.register(runtimeService);

  return new Runtime(serviceManager);
};

const workspaces: string[] = [];
const memoryServices: MemoryService[] = [];

beforeEach(() => {
  streamText.mockReset();
  generateText.mockReset();
  outputObject.mockClear();
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_COMPATIBLE_API_KEY = "test-openai-compatible-key";
  process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
});

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
    transport: {
      formalConversationMaxOutputTokens: 2000,
    },
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
    workspace,
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
    transport: {
      formalConversationMaxOutputTokens: 2000,
    },
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
    priority: overrides.priority ?? 2,
    eventTarget: overrides.eventTarget ?? undefined,
    channel: overrides.channel ?? { domain: "tui" },
    payload: overrides.payload ?? [{ type: "text", data: "hello runtime" }],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...(typeof overrides.chainRound === "number"
      ? { chainRound: overrides.chainRound }
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

    expect(prompt).toContain("# Runtime System Prompt");
    expect(prompt).toContain("# 3. Intent Request（内部请求协议）");
    expect(prompt).toContain("# 4. Memory 子协议（按需激活）");
    expect(prompt).toContain("# 5. Follow-up 子协议（按需激活）");
    expect(prompt).toContain("<<<REQUEST>>>");
    expect(prompt).toContain("<IntentPolicy>");
    expect(prompt).not.toContain("ACCEPTED_INTENT_TYPE=");
    expect(prompt).toContain("<Conversation>\nSTATE=empty\n</Conversation>");
    expect(prompt).toContain("如果问题明显属于 2，必须优先按记忆规则执行");
    expect(prompt).toContain("不要跳过记忆流程直接回答“没有找到相关记忆”或“我不记得”");
    expect(prompt).toContain("只有在必须依赖 Runtime 协助时才允许使用");
    expect(prompt).toContain("不要只输出“我先看看”“我先了解一下”“让我检查一下”这类计划性过渡句然后结束当前轮");
    expect(prompt).toContain("<OutputBudget>");
    expect(prompt).toContain("MAX_OUTPUT_TOKENS=2000");
    expect(prompt).toContain("REQUEST_TOKEN_RESERVE=256");
    expect(prompt).toContain("VISIBLE_OUTPUT_BUDGET=1744");
    expect(prompt).toContain("如果存在 `<FollowUp>` 且 `CHAIN_ROUND` 不为空");
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

  test("renders workspace in runtime prompt when cli workspace is available", async () => {
    const { runtime, workspace } = await buildRuntimeWithToolService();

    runtime.currentTask = buildTask("task-workspace-prompt");

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain(`Workspace = ${workspace}`);
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

  test("executeConversationToolCalls writes tool context and replaces duplicated target", async () => {
    const { runtime, workspace } = await buildRuntimeWithToolService();
    const filepath = join(workspace, "tool-context.txt");
    await writeFile(filepath, "line-1\nline-2");

    runtime.currentTask = buildTask("task-tool-context-1");

    const firstResult = await runtime.executeConversationToolCalls([
      {
        toolName: "read",
        toolCallId: "call_1",
        input: { filepath },
      },
    ]);

    expect(firstResult).toEqual({ ok: true });
    expect(runtime.getToolContext().results).toHaveLength(1);

    const secondResult = await runtime.executeConversationToolCalls([
      {
        toolName: "read",
        toolCallId: "call_2",
        input: { filepath },
      },
    ]);

    expect(secondResult).toEqual({ ok: true });
    expect(runtime.getToolContext().results).toHaveLength(1);

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });
    expect(prompt).toContain("<ToolContext>");
    expect(prompt).toContain("<Mode>active</Mode>");
    expect(prompt).toContain("<ToolName>read</ToolName>");
    expect(prompt).toContain(filepath);
    expect(prompt).toContain("<OutputDetail>");
    expect(prompt).toContain("0 | line-1");
    expect(prompt).toContain("1 | line-2");
  });

  test("executeConversationToolCalls keeps one file snapshot across read and write", async () => {
    const { runtime, workspace } = await buildRuntimeWithToolService();
    const filepath = join(workspace, "tool-snapshot.txt");
    await writeFile(filepath, "before\nstate");

    runtime.currentTask = buildTask("task-tool-context-2");

    await runtime.executeConversationToolCalls([
      {
        toolName: "read",
        toolCallId: "call_read",
        input: { filepath },
      },
    ]);

    const writeResult = await runtime.executeConversationToolCalls([
      {
        toolName: "write",
        toolCallId: "call_write",
        input: {
          filepath,
          content: "after\nstate\nupdated",
        },
      },
    ]);

    expect(writeResult).toEqual({ ok: true });
    expect(runtime.getToolContext().results).toHaveLength(1);

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });
    expect(prompt).toContain("<ToolName>write</ToolName>");
    expect(prompt).toContain("overwrite write");
    expect(prompt).toContain("0 | after");
    expect(prompt).toContain("1 | state");
    expect(prompt).toContain("2 | updated");
    expect(prompt).not.toContain("0 | before");
  });

  test("executeIntentRequests finishes tool mode and schedules plain continuation when nextPrompt is present", async () => {
    const { runtime, workspace } = await buildRuntimeWithServices();
    const task = buildTask("task-tool-finished-1");
    const filepath = join(workspace, "tool-finished.txt");
    await writeFile(filepath, "line-1");

    runtime.currentTask = task;
    runtime.activateToolContext();
    await runtime.executeConversationToolCalls([
      {
        toolName: "read",
        toolCallId: "call_read",
        input: { filepath },
      },
    ]);

    const result = await runtime.executeIntentRequests(task, [
      {
        request: "FOLLOW_UP_WITH_TOOLS_FINISHED",
        intent: "结束工具阶段",
        params: {
          summary: "已完成工具检查",
          nextPrompt: "基于当前结果整理最终回答",
        },
      },
    ]);

    expect(result.status).toBe("stop");
    expect(result.nextState).toBe(TaskState.FOLLOW_UP);
    expect(result.nextTask?.source).toBe(TaskSource.INTERNAL);
    expect(runtime.hasActiveToolContext()).toBe(false);
    expect(runtime.getToolContext().updatedAt).toBeNull();
    expect(runtime.getToolContext().results).toEqual([]);
    expect(runtime.getContinuationContext()).toEqual({
      summary: "已完成工具检查",
      nextPrompt: "基于当前结果整理最终回答",
      avoidRepeat: "",
      updatedAt: expect.any(Number),
    });
  });

  test("executeIntentRequests clears tool context immediately when tool phase ends", async () => {
    const { runtime, workspace } = await buildRuntimeWithServices();
    const task = buildTask("task-tool-ended-1");
    const filepath = join(workspace, "tool-ended.txt");
    await writeFile(filepath, "line-1");

    runtime.currentTask = task;
    runtime.activateToolContext();
    await runtime.executeConversationToolCalls([
      {
        toolName: "read",
        toolCallId: "call_read",
        input: { filepath },
      },
    ]);

    const result = await runtime.executeIntentRequests(task, [
      {
        request: "FOLLOW_UP_WITH_TOOLS_END",
        intent: "异常结束工具阶段",
        params: {
          reasonCode: "tool_error",
          reason: "read 工具结果不可继续使用",
        },
      },
    ]);

    expect(result).toEqual({
      status: "continue",
    });
    expect(runtime.getToolContext().updatedAt).toBeNull();
    expect(runtime.getToolContext().results).toEqual([]);
  });

  test("preparePostFollowUpContinuation writes continuation from compressed follow up intent", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      payload: [{ type: "text", data: "original question" }],
    });
    runtime.appendAssistantOutput("第一段。");
    runtime.appendAssistantOutput("第二段。");

    runtime.currentTask = buildTask("task-2", {
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      pipeline: "post_follow_up",
      chainRound: 1,
      payload: [{ type: "text", data: "已完成前半部分，下一轮继续剩余分析。" }],
    });

    generateText.mockResolvedValue({
      output: {
        summary: "已完成前半部分。",
        nextPrompt: "继续补充剩余分析，不要重复前文。",
        avoidRepeat: "不要重复第一段和第二段。",
      },
    });

    const result = await runtime.preparePostFollowUpContinuation();

    expect(result).toEqual({
      summary: "已完成前半部分。",
      nextPrompt: "继续补充剩余分析，不要重复前文。",
      avoidRepeat: "不要重复第一段和第二段。",
      fallbackUsed: false,
    });
    expect(runtime.getContinuationContext()).toMatchObject({
      summary: "已完成前半部分。",
      nextPrompt: "继续补充剩余分析，不要重复前文。",
      avoidRepeat: "不要重复第一段和第二段。",
    });
  });

  test("preparePostFollowUpContinuation falls back when post follow up output is invalid", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      payload: [{ type: "text", data: "original question" }],
    });
    runtime.appendAssistantOutput("existing output");

    runtime.currentTask = buildTask("task-2", {
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      pipeline: "post_follow_up",
      chainRound: 1,
      payload: [{ type: "text", data: "已完成前半部分，下一轮继续剩余分析。" }],
    });

    generateText.mockResolvedValue({
      output: {
        summary: "",
        nextPrompt: "",
        avoidRepeat: "",
      },
    });

    const result = await runtime.preparePostFollowUpContinuation();

    expect(result.fallbackUsed).toBe(true);
    expect(result.summary).toContain("已完成前半部分");
    expect(result.nextPrompt).toBe(
      "基于当前 FollowUp 上下文继续当前回答，不要重复前文。",
    );
    expect(result.avoidRepeat).toBe("不要重复已经输出的内容。");
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
    runtime.appendAssistantOutput("final answer");

    const finalizationResult = runtime.finalizeChatTurn(task, {
      resultText: "final answer",
      visibleTextBuffer: "final answer",
    });

    expect(finalizationResult.finalMessage).toBe("final answer");
    expect(finalizationResult.visibleChunk).toBe("final answer");
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

  test("finalizeChatTurn keeps accumulated output as final message for follow up chat", () => {
    const runtime = buildRuntime();

    const firstTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "original question" }],
    });
    runtime.currentTask = firstTask;
    runtime.appendAssistantOutput("第一段。");

    const followUpTask = buildTask("task-2", {
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      chainRound: 1,
      payload: [],
    });
    runtime.currentTask = followUpTask;
    runtime.appendAssistantOutput("第二段。");

    const finalizationResult = runtime.finalizeChatTurn(followUpTask, {
      resultText: "第二段。",
      visibleTextBuffer: "第二段。",
    });

    expect(finalizationResult.finalMessage).toBe("第一段。第二段。");
    expect(finalizationResult.completedPayload.message.data).toBe(
      "第一段。第二段。",
    );
  });

  test("finalizeChatTurn appends visible failure chunk after prior streamed output", () => {
    const runtime = buildRuntime();

    const task = buildTask("task-tool-failure-finalize", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "check workspace" }],
    });
    runtime.currentTask = task;
    runtime.appendAssistantOutput("我先检查一下。");

    const finalizationResult = runtime.finalizeChatTurn(task, {
      resultText: "工具调用失败，暂时无法继续分析当前工作区。错误：Permission denied",
      visibleTextBuffer: "工具调用失败，暂时无法继续分析当前工作区。错误：Permission denied",
    });

    expect(finalizationResult.finalMessage).toBe(
      "我先检查一下。工具调用失败，暂时无法继续分析当前工作区。错误：Permission denied",
    );
    expect(finalizationResult.completedPayload.message.data).toBe(
      "我先检查一下。工具调用失败，暂时无法继续分析当前工作区。错误：Permission denied",
    );
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
      parentTaskId: "task-1",
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      priority: 1,
      payload: [{ type: "text", data: "continue" }],
      chainRound: 1,
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

  test("compresses follow up prompt with continuation summary and recent tail for internal follow up", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      payload: [{ type: "text", data: "original question" }],
    });
    runtime.appendAssistantOutput(`${"A".repeat(1200)}${"B".repeat(1200)}`);
    runtime.setContinuationContext({
      summary: "已完成前半部分。",
      nextPrompt: "继续补充剩余内容。",
      avoidRepeat: "不要重复前文。",
    });

    runtime.currentTask = buildTask("task-2", {
      chainId: "task-1",
      parentTaskId: "task-1",
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      priority: 1,
      payload: [],
      chainRound: 1,
    });

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain(
      "ACCUMULATED_ASSISTANT_SUMMARY<<EOF\n已完成前半部分。\nEOF",
    );
    expect(prompt).toContain("RECENT_ASSISTANT_OUTPUT<<EOF");
    expect(prompt).not.toContain("ACCUMULATED_ASSISTANT_OUTPUT<<EOF");
    expect(prompt).toContain("B".repeat(1200));
    expect(prompt).not.toContain("A".repeat(1000));
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
      topicRelation: "uncertain",
      shouldIsolateConversation: false,
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
      maxOutputTokens: 2000,
      requestTokenReserve: 256,
      visibleOutputBudget: 1744,
      preferEarlyFollowUp: true,
      isNewChatInSession: true,
      topicRelation: "related",
      shouldIsolateConversation: false,
      responseStrategyText: [
        "当前轮输出预算：",
        "- MAX_OUTPUT_TOKENS=2000",
        "- REQUEST_TOKEN_RESERVE=256",
        "- VISIBLE_OUTPUT_BUDGET=1744",
        "",
        "会话规则：",
        "- 这是同一 session 下的新 chat，不是上一个 chat 的自然尾声",
      ].join("\n"),
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
    expect(prompt).toContain("MAX_OUTPUT_TOKENS=2000");
    expect(prompt).toContain("REQUEST_TOKEN_RESERVE=256");
    expect(prompt).toContain("VISIBLE_OUTPUT_BUDGET=1744");
    expect(prompt).toContain("PREFER_EARLY_FOLLOW_UP=true");
    expect(prompt).toContain("IS_NEW_CHAT_IN_SESSION=true");
    expect(prompt).toContain("TOPIC_RELATION=related");
    expect(prompt).toContain("SHOULD_ISOLATE_CONVERSATION=false");
    expect(prompt).toContain("RESPONSE_STRATEGY<<EOF");
    expect(prompt).toContain("- MAX_OUTPUT_TOKENS=2000");
    expect(prompt).toContain("这是同一 session 下的新 chat");
  });

  test("prepareExecutionContext predicts intent and preloads long memory for external task", async () => {
    const { runtime, memoryService } = await buildRuntimeWithServices();

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

    generateText.mockResolvedValue({
      output: {
        type: "memory_lookup",
        topicRelation: "related",
        needsMemory: true,
        needsMemorySave: false,
        memoryQuery: "AGENTS md",
        confidence: 0.95,
      },
    });

    const request = await runtime.prepareExecutionContext(task);

    expect(request?.source).toBe("prediction");
    expect(request?.request).toBe("PREPARE_CONVERSATION");
    expect(request?.params.acceptedIntentType).toBe("memory_lookup");
    expect(request?.params.preloadMemory).toBe(true);
    expect(request?.params.memoryQuery).toBe("AGENTS md");
    expect(request?.params.maxOutputTokens).toBe(2000);
    expect(request?.params.requestTokenReserve).toBe(256);
    expect(request?.params.visibleOutputBudget).toBe(1744);
    expect(request?.params.preferEarlyFollowUp).toBe(true);
    expect(request?.params.isNewChatInSession).toBe(false);
    expect(request?.params.topicRelation).toBe("related");
    expect(request?.params.shouldIsolateConversation).toBe(false);
    expect(request?.params.responseStrategyText).toContain("MAX_OUTPUT_TOKENS=2000");
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
        maxOutputTokens: 2000,
        requestTokenReserve: 256,
        visibleOutputBudget: 1744,
        preferEarlyFollowUp: true,
        isNewChatInSession: false,
        topicRelation: "related",
        shouldIsolateConversation: false,
        responseStrategyText: "预算策略：MAX_OUTPUT_TOKENS=2000",
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
    expect(prompt).toContain("预算策略：MAX_OUTPUT_TOKENS=2000");
  });

  test("prepareExecutionContext skips prediction for internal task", async () => {
    const { runtime } = await buildRuntimeWithServices();

    const task = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      source: TaskSource.INTERNAL,
      payload: [{ type: "text", data: "continue" }],
      chainRound: 1,
    });
    runtime.currentTask = task;

    let called = false;
    generateText.mockImplementation(async () => {
      called = true;
      return {
        output: {
          type: "memory_lookup",
          topicRelation: "related",
        },
      };
    });

    const policy = await runtime.prepareExecutionContext(task);

    expect(called).toBe(false);
    expect(policy).toBeNull();
    expect(runtime.getMemoryContext("long").status).toBe("idle");
  });

  test("prepareExecutionContext archives previous conversation into short memory for unrelated topic", async () => {
    const { runtime } = await buildRuntimeWithServices();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "继续上一个架构设计" }],
    });
    runtime.commitSessionTurn(
      "继续上一个架构设计",
      "上一轮我们讨论了 Runtime、Transport 和 Queue 的职责边界。",
    );

    const task = buildTask("task-2", {
      sessionId: "session-1",
      chatId: "chat-2",
      payload: [{ type: "text", data: "顺便推荐几种适合新手的咖啡豆" }],
    });
    runtime.currentTask = task;

    generateText.mockResolvedValue({
      output: {
        type: "direct_answer",
        topicRelation: "unrelated",
        needsMemory: false,
        needsMemorySave: false,
        memoryQuery: "",
        confidence: 0.91,
      },
    });

    const request = await runtime.prepareExecutionContext(task);
    const shortMemory = runtime.getMemoryContext("short");
    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(request?.params.topicRelation).toBe("unrelated");
    expect(request?.params.shouldIsolateConversation).toBe(true);
    expect(request?.params.isNewChatInSession).toBe(true);
    expect(shortMemory.status).toBe("loaded");
    expect(shortMemory.kind).toBe("topic_archive");
    expect(shortMemory.archivedFromConversation).toBe(true);
    expect(shortMemory.ttlTurnsRemaining).toBe(5);
    expect(shortMemory.outputs[0]?.memory.key).toContain("runtime.short.topic_archive.");
    expect(prompt).toContain("<Conversation>\nSTATE=empty\n</Conversation>");
    expect(prompt).toContain("<Kind>topic_archive</Kind>");
    expect(prompt).toContain("<TTLTurnsRemaining>5</TTLTurnsRemaining>");
    expect(prompt).toContain("TOPIC_RELATION=unrelated");
    expect(prompt).toContain("SHOULD_ISOLATE_CONVERSATION=true");
  });

  test("topic archive ttl decreases only on later external chats and clears at zero", async () => {
    const { runtime } = await buildRuntimeWithServices();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "延续上个话题" }],
    });
    runtime.commitSessionTurn(
      "延续上个话题",
      "上一轮讨论了 watchman 和 memory 的边界。",
    );

    const isolateTask = buildTask("task-2", {
      sessionId: "session-1",
      chatId: "chat-2",
      payload: [{ type: "text", data: "推荐一个跑步耳机" }],
    });
    runtime.currentTask = isolateTask;

    generateText.mockResolvedValue({
      output: {
        type: "direct_answer",
        topicRelation: "unrelated",
        needsMemory: false,
        needsMemorySave: false,
        memoryQuery: "",
        confidence: 0.9,
      },
    });

    await runtime.prepareExecutionContext(isolateTask);
    expect(runtime.getMemoryContext("short").ttlTurnsRemaining).toBe(5);

    const internalTask = buildTask("task-3", {
      sessionId: "session-1",
      chatId: "chat-2",
      source: TaskSource.INTERNAL,
      payload: [{ type: "text", data: "continue" }],
      chainRound: 1,
    });
    runtime.currentTask = internalTask;
    await runtime.prepareExecutionContext(internalTask);
    expect(runtime.getMemoryContext("short").ttlTurnsRemaining).toBe(5);

    for (let index = 0; index < 4; index += 1) {
      const externalTask = buildTask(`task-ext-${index}`, {
        sessionId: "session-1",
        chatId: `chat-ext-${index}`,
        payload: [{ type: "text", data: `新的相关问题 ${index}` }],
      });
      runtime.currentTask = externalTask;

      generateText.mockResolvedValue({
        output: {
          type: "direct_answer",
          topicRelation: "related",
          needsMemory: false,
          needsMemorySave: false,
          memoryQuery: "",
          confidence: 0.9,
        },
      });

      await runtime.prepareExecutionContext(externalTask);
      expect(runtime.getMemoryContext("short").ttlTurnsRemaining).toBe(4 - index);
    }

    const clearTask = buildTask("task-clear", {
      sessionId: "session-1",
      chatId: "chat-clear",
      payload: [{ type: "text", data: "最后一个新问题" }],
    });
    runtime.currentTask = clearTask;
    await runtime.prepareExecutionContext(clearTask);

    expect(runtime.getMemoryContext("short").status).toBe("idle");
    expect(runtime.getMemoryContext("short").ttlTurnsRemaining).toBeNull();
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
    expect(result.nextTask?.pipeline).toBe("post_follow_up");
    expect(result.nextTask?.payload).toEqual([
      { type: "text", data: "基于记忆继续回答" },
    ]);
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
    expect(result.nextTask?.pipeline).toBe("post_follow_up");
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
      topicRelation: "uncertain",
      shouldIsolateConversation: false,
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
      '[FOLLOW_UP, "已完成前半部分，下一轮继续补充实现步骤"]',
    );

    expect(result.safeRequests).toEqual([{
      source: "conversation",
      request: "FOLLOW_UP",
      intent: "已完成前半部分，下一轮继续补充实现步骤",
      params: {},
    }]);
  });

  test("returns safe follow up with tools request when runtime safety passes", () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    const result = runtime.parseIntentRequest(
      '[FOLLOW_UP_WITH_TOOLS, "继续验证", summary=已确认当前结果;nextPrompt=继续检查剩余工具链路;avoidRepeat=不要重复前文]',
    );

    expect(result.safeRequests).toEqual([{
      source: "conversation",
      request: "FOLLOW_UP_WITH_TOOLS",
      intent: "继续验证",
      params: {
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
        '[FOLLOW_UP, "继续当前回答"]',
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
        params: {},
      },
    ]);
  });

  test("returns no safe requests when runtime context is missing", () => {
    const runtime = buildRuntime();

    const result = runtime.parseIntentRequest(
      '[FOLLOW_UP, "继续当前回答"]',
    );

    expect(result.safeRequests).toEqual([]);
    expect(result.rejectedRequests).toHaveLength(1);
    expect(result.dispatchResults).toEqual([]);
  });
});
