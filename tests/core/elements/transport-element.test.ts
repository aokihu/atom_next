// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";
import {
  PipelineEventBus,
  type PipelineEventMap,
} from "@/core/pipeline";
import { createTransportElement } from "@/core/elements";

const streamText = mock();
const stepCountIs = mock((stepCount) => ({
  type: "step-count",
  stepCount,
}));

mock.module("ai", () => ({
  streamText,
  stepCountIs,
  generateText: mock(),
  Output: {
    object: mock(),
  },
}));

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
  chunks = [],
  consumeErrors = [],
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
    consumeStream: async (options = {}) => {
      for (const chunk of chunks) {
        await currentCallOptions?.onChunk?.({ chunk });
      }

      for (const error of consumeErrors) {
        await options.onError?.(error);
      }
    },
    finishReason: Promise.resolve(finishReason),
    usage: Promise.resolve(usage),
    totalUsage: Promise.resolve(totalUsage),
    steps: Promise.resolve(steps),
    response: Promise.resolve(response),
  };
};

let currentCallOptions;

describe("createTransportElement", () => {
  beforeEach(() => {
    currentCallOptions = undefined;
    streamText.mockReset();
    stepCountIs.mockClear();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_COMPATIBLE_API_KEY = "test-openai-compatible-key";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  });

  test("runs transport directly and forwards stream callbacks through pipeline events", async () => {
    streamText.mockImplementation((options) => {
      currentCallOptions = options;

      return {
        consumeStream: async () => {
          await options.experimental_onToolCallStart?.({
            toolCall: {
              toolName: "read",
              toolCallId: "call-1",
              input: { filepath: "/tmp/demo.txt" },
            },
          });

          await options.onChunk?.({
            chunk: { type: "text-delta", text: "visible" },
          });

          await options.experimental_onToolCallFinish?.({
            toolCall: {
              toolName: "read",
              toolCallId: "call-1",
              input: { filepath: "/tmp/demo.txt" },
            },
            success: true,
            output: { ok: true },
          });
        },
        finishReason: Promise.resolve("stop"),
        usage: Promise.resolve({
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        }),
        totalUsage: Promise.resolve({
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        }),
        steps: Promise.resolve([
          {
            toolCalls: [{ toolName: "read" }],
            toolResults: [{ toolName: "read" }],
          },
        ]),
        response: Promise.resolve({
          messages: [{ role: "assistant" }],
        }),
      };
    });

    const eventBus = new PipelineEventBus<PipelineEventMap>();
    const delta = mock(() => {});
    const toolStarted = mock(() => {});
    const toolFinished = mock(() => {});
    eventBus.on("transport.delta", delta);
    eventBus.on("transport.tool.started", toolStarted);
    eventBus.on("transport.tool.finished", toolFinished);

    const element = createTransportElement({
      serviceManager: buildServiceManager(),
    });
    const result = await element.process(
      {
        transportPayload: {
          systemPrompt: "system",
          userPrompt: "user",
          options: {
            maxOutputTokens: 128,
            tools: {
              read: {
                description: "read file",
                inputSchema: {},
              },
            },
            maxToolSteps: 7,
          },
        },
      },
      {
        task: { id: "task-1" } as any,
        eventBus,
      },
    );

    expect(stepCountIs).toHaveBeenCalledWith(7);
    expect(currentCallOptions.system).toBe("system");
    expect(currentCallOptions.prompt).toBe("user");
    expect(currentCallOptions.maxOutputTokens).toBe(128);
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

  test("emits transport.failed and rethrows when streamText fails", async () => {
    const error = new Error("send failed");
    streamText.mockImplementation(() => {
      throw error;
    });

    const eventBus = new PipelineEventBus<PipelineEventMap>();
    const failed = mock(() => {});
    eventBus.on("transport.failed", failed);

    const element = createTransportElement({
      serviceManager: buildServiceManager(),
    });

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

  test("emits transport.failed for provider and consumeStream errors without calling user callbacks", async () => {
    const providerError = new Error("provider failed");
    const streamError = new Error("stream failed");
    const userOnError = mock(() => {});

    streamText.mockImplementation((options) => {
      currentCallOptions = options;
      options.onError?.({ error: providerError });

      return buildStreamResult({
        consumeErrors: [streamError],
      });
    });

    const eventBus = new PipelineEventBus<PipelineEventMap>();
    const failed = mock(() => {});
    eventBus.on("transport.failed", failed);

    const element = createTransportElement({
      serviceManager: buildServiceManager(),
    });

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

    expect(failed.mock.calls).toEqual([
      [{ error: providerError }],
      [{ error: streamError }],
    ]);
    expect(userOnError).not.toHaveBeenCalled();
  });
});
