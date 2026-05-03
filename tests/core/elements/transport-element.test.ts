import { describe, expect, mock, test } from "bun:test";
import {
  PipelineEventBus,
  type PipelineEventMap,
} from "@/core/pipeline";
import { createTransportElement } from "@/core/elements";

describe("createTransportElement", () => {
  test("calls transport.send and forwards callbacks through pipeline events", async () => {
    const transport = {
      send: mock(async (_systemPrompt, _userPrompt, options) => {
        await options.onTextDelta?.("visible");
        await options.onToolCallStart?.({
          toolName: "read",
          toolCallId: "call-1",
          input: { filepath: "/tmp/demo.txt" },
        });
        await options.onToolCallFinish?.({
          toolName: "read",
          toolCallId: "call-1",
          input: { filepath: "/tmp/demo.txt" },
          result: { ok: true },
        });

        return {
          text: "visible",
          intentRequestText: "",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          stepCount: 1,
          toolCallCount: 1,
          toolResultCount: 1,
          responseMessageCount: 1,
          pendingToolCalls: [],
        };
      }),
    };

    const eventBus = new PipelineEventBus<PipelineEventMap>();
    const delta = mock(() => {});
    const toolStarted = mock(() => {});
    const toolFinished = mock(() => {});
    eventBus.on("transport.delta", delta);
    eventBus.on("transport.tool.started", toolStarted);
    eventBus.on("transport.tool.finished", toolFinished);

    const element = createTransportElement(transport as any);
    const result = await element.process(
      {
        transportPayload: {
          systemPrompt: "system",
          userPrompt: "user",
          options: {
            maxOutputTokens: 128,
          },
        },
      },
      {
        task: { id: "task-1" } as any,
        eventBus,
      },
    );

    expect(transport.send).toHaveBeenCalledWith(
      "system",
      "user",
      expect.objectContaining({
        maxOutputTokens: 128,
        onTextDelta: expect.any(Function),
        onToolCallStart: expect.any(Function),
        onToolCallFinish: expect.any(Function),
      }),
    );
    expect(result.transportOutput.text).toBe("visible");
    expect(delta).toHaveBeenCalledWith({ textDelta: "visible" });
    expect(toolStarted).toHaveBeenCalledWith({
      toolName: "read",
      toolCallId: "call-1",
      input: { filepath: "/tmp/demo.txt" },
    });
    expect(toolFinished).toHaveBeenCalledWith({
      toolName: "read",
      toolCallId: "call-1",
      input: { filepath: "/tmp/demo.txt" },
      result: { ok: true },
    });
  });

  test("emits transport.failed and rethrows on send failure", async () => {
    const error = new Error("send failed");
    const transport = {
      send: mock(async () => {
        throw error;
      }),
    };
    const eventBus = new PipelineEventBus<PipelineEventMap>();
    const failed = mock(() => {});
    eventBus.on("transport.failed", failed);

    const element = createTransportElement(transport as any);

    await expect(
      element.process(
        {
          transportPayload: {
            systemPrompt: "system",
            userPrompt: "user",
          },
        },
        {
          task: { id: "task-2" } as any,
          eventBus,
        },
      ),
    ).rejects.toThrow("send failed");

    expect(failed).toHaveBeenCalledWith({ error });
  });

  test("does not call user-provided onError callback from transport payload options", async () => {
    const error = new Error("provider failed");
    const transport = {
      send: mock(async (_systemPrompt, _userPrompt, options) => {
        await options.onError?.(error);

        return {
          text: "",
          intentRequestText: "",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          stepCount: 1,
          toolCallCount: 0,
          toolResultCount: 0,
          responseMessageCount: 1,
          pendingToolCalls: [],
        };
      }),
    };
    const eventBus = new PipelineEventBus<PipelineEventMap>();
    const failed = mock(() => {});
    const userOnError = mock(() => {});
    eventBus.on("transport.failed", failed);

    const element = createTransportElement(transport as any);

    await element.process(
      {
        transportPayload: {
          systemPrompt: "system",
          userPrompt: "user",
          options: {
            maxOutputTokens: 128,
            onError: userOnError,
          } as any,
        },
      },
      {
        task: { id: "task-3" } as any,
        eventBus,
      },
    );

    expect(failed).toHaveBeenCalledWith({ error });
    expect(userOnError).not.toHaveBeenCalled();
  });
});
