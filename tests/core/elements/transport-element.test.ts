import { describe, expect, mock, test } from "bun:test";
import { createTaskItem } from "@/libs/task";
import { createTransportElement } from "@/core/elements";
import {
  RuntimeEventBus,
  type PipelineContext,
  type RuntimePipelineEvent,
} from "@/core/pipeline";
import type { TransportPort } from "@/core/transport";

const buildContext = (): PipelineContext => {
  const task = createTaskItem({
    sessionId: "session-1",
    chatId: "chat-1",
    payload: [{ type: "text", data: "hello" }],
  });

  return {
    run: {
      taskId: task.id,
      chainId: task.chainId,
    },
    eventBus: new RuntimeEventBus(),
  };
};

describe("createTransportElement", () => {
  test("calls transport.send and emits transport events", async () => {
    const context = buildContext();
    const events: RuntimePipelineEvent[] = [];
    const onTextDelta = mock(() => {});
    const onToolCallStart = mock(() => {});
    const onToolCallFinish = mock(() => {});
    const send = mock(async (_systemPrompt, _userPrompt, options) => {
        await options?.onTextDelta?.("delta");
        await options?.onToolCallStart?.({ toolName: "read", input: { path: "a" } });
        await options?.onToolCallFinish?.({
          toolName: "read",
          input: { path: "a" },
          result: { ok: true },
        });

        return {
          text: "answer",
          intentRequestText: "",
          finishReason: "stop" as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          stepCount: 1,
          toolCallCount: 1,
          toolResultCount: 1,
          responseMessageCount: 1,
          pendingToolCalls: [],
        };
      });
    const transport = { send } as unknown as TransportPort;

    context.eventBus.onAny((event) => {
      events.push(event);
    });

    const element = createTransportElement(transport);
    const result = await element.process(
      {
        systemPrompt: "system",
        userPrompt: "user",
        options: {
          maxOutputTokens: 32,
          onTextDelta,
          onToolCallStart,
          onToolCallFinish,
        },
      },
      context,
    );

    expect(send).toHaveBeenCalledWith("system", "user", expect.objectContaining({
      maxOutputTokens: 32,
      onTextDelta: expect.any(Function),
      onToolCallStart: expect.any(Function),
      onToolCallFinish: expect.any(Function),
    }));
    expect(result.text).toBe("answer");
    expect(onTextDelta).toHaveBeenCalledWith("delta");
    expect(onToolCallStart).toHaveBeenCalledWith({
      toolName: "read",
      input: { path: "a" },
    });
    expect(onToolCallFinish).toHaveBeenCalledWith({
      toolName: "read",
      input: { path: "a" },
      result: { ok: true },
    });
    expect(events.map((event) => event.type)).toEqual([
      "transport.delta",
      "transport.tool.started",
      "transport.tool.finished",
    ]);
  });

  test("emits transport.failed and rethrows the error", async () => {
    const context = buildContext();
    const events: RuntimePipelineEvent[] = [];
    const send = mock(async () => {
        throw new Error("boom");
      });
    const transport = { send } as unknown as TransportPort;

    context.eventBus.onAny((event) => {
      events.push(event);
    });

    const element = createTransportElement(transport);

    await expect(
      element.process(
        {
          systemPrompt: "system",
          userPrompt: "user",
        },
        context,
      ),
    ).rejects.toThrow("boom");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "transport.failed",
      taskId: context.run.taskId,
      chainId: context.run.chainId,
      error: "boom",
    });
  });
});
