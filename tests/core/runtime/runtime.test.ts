// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { Runtime } from "@/core/runtime";
import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";
import { TaskSource, TaskState, type TaskItem } from "@/types/task";

const buildRuntime = () => {
  const serviceManager = new ServiceManager();
  const runtimeService = new RuntimeService();

  serviceManager.register(runtimeService);

  return new Runtime(serviceManager);
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
  test("does not render follow up block before task is bound", async () => {
    const runtime = buildRuntime();

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain("# Intent Request 使用规范");
    expect(prompt).toContain("# Memory 使用规范");
    expect(prompt).toContain("# FOLLOW_UP 使用规范");
    expect(prompt).toContain("<<<REQUEST>>>");
    expect(prompt).toContain("当你提交 `SEARCH_MEMORY` 请求时");
    expect(prompt).toContain("不要只单独提交 `SEARCH_MEMORY`");
    expect(prompt).toContain("当前只允许触发一次");
    expect(prompt).toContain("如果 `<Memory>` 仍然为空");
    expect(prompt).toContain("当一次回答无法在单轮输出中安全完成时");
    expect(prompt).not.toContain("<FollowUp>\n<ChatId>");
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
    expect(prompt).toContain("<FollowUp>");
    expect(prompt).toContain("<ChatId>chat-1</ChatId>");
    expect(prompt).toContain("<ChainRound></ChainRound>");
    expect(prompt).toContain("<OriginalUserInput>\nline-1\nline-2\n</OriginalUserInput>");
    expect(prompt).toContain(
      "<AccumulatedAssistantOutput>\n\n</AccumulatedAssistantOutput>",
    );
  });

  test("appends assistant output in order and preserves multiline content", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1");
    runtime.appendAssistantOutput("part-1\n");
    runtime.appendAssistantOutput("part-2");

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain(
      "<AccumulatedAssistantOutput>\npart-1\npart-2\n</AccumulatedAssistantOutput>",
    );
  });

  test("keeps original input and accumulated output for internal task in same chat", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      payload: [{ type: "text", data: "original question" }],
    });
    runtime.recordMemorySearchResult("long", {
      words: "watchman",
      output: {
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
    expect(prompt).toContain("<ChatId>chat-1</ChatId>");
    expect(prompt).toContain("<ChainRound>1</ChainRound>");
    expect(prompt).toContain(
      "<OriginalUserInput>\noriginal question\n</OriginalUserInput>",
    );
    expect(prompt).toContain(
      "<AccumulatedAssistantOutput>\nexisting output\n</AccumulatedAssistantOutput>",
    );
    expect(prompt).toContain("<Long>");
    expect(prompt).toContain("<Status>loaded</Status>");
    expect(prompt).toContain("<Query>watchman</Query>");
    expect(prompt).toContain("<Key>long.note.watchman</Key>");
    expect(prompt).toContain("Watchman 不负责 Memory 持久化。");
  });

  test("resets accumulated output and increments round when chat changes", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "first question" }],
    });
    runtime.appendAssistantOutput("first output");

    runtime.currentTask = buildTask("task-2", {
      sessionId: "session-1",
      chatId: "chat-2",
      payload: [{ type: "text", data: "second question" }],
    });

    const prompt = await runtime.exportSystemPrompt({
      ignoreWatchman: true,
    });

    expect(prompt).toContain("Round = 2");
    expect(prompt).toContain("<ChatId>chat-2</ChatId>");
    expect(prompt).toContain(
      "<OriginalUserInput>\nsecond question\n</OriginalUserInput>",
    );
    expect(prompt).toContain(
      "<AccumulatedAssistantOutput>\n\n</AccumulatedAssistantOutput>",
    );
    expect(prompt).toContain("<Long></Long>");
  });

  test("renders empty memory search state after miss", async () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1");
    runtime.recordMemorySearchResult("long", {
      words: "missing memory",
      output: null,
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

  test("returns safe follow up request when runtime safety passes", () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    const result = runtime.parseLLMRequest(
      '[FOLLOW_UP, "已完成前半部分，下一轮继续补充实现步骤", sessionId=session-1;chatId=chat-1]',
    );

    expect(result.safeRequests).toEqual([{
      request: "FOLLOW_UP",
      intent: "已完成前半部分，下一轮继续补充实现步骤",
      params: {
        sessionId: "session-1",
        chatId: "chat-1",
      },
    }]);
  });

  test("keeps safe request order when multiple requests pass runtime safety", () => {
    const runtime = buildRuntime();

    runtime.currentTask = buildTask("task-1", {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    const result = runtime.parseLLMRequest(
      [
        '[SEARCH_MEMORY, "搜索上下文记忆", words=follow up]',
        '[FOLLOW_UP, "继续当前回答", sessionId=session-1;chatId=chat-1]',
      ].join("\n"),
    );

    expect(result.safeRequests).toEqual([
      {
        request: "SEARCH_MEMORY",
        intent: "搜索上下文记忆",
        params: {
          words: "follow up",
        },
      },
      {
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

    const result = runtime.parseLLMRequest(
      '[FOLLOW_UP, "继续当前回答", sessionId=session-1;chatId=chat-1]',
    );

    expect(result.safeRequests).toEqual([]);
    expect(result.rejectedRequests).toHaveLength(1);
    expect(result.dispatchResults).toEqual([]);
  });
});
