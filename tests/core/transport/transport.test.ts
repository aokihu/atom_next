//@ts-nockeck
// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";

const streamText = mock();

mock.module("ai", () => ({
  streamText,
}));

const { Transport } = await import("@/core/transport/transport");

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
  };
};

let currentCallOptions;

describe("Transport.send", () => {
  beforeEach(() => {
    currentCallOptions = undefined;
    streamText.mockReset();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_COMPATIBLE_API_KEY = "test-openai-compatible-key";
  });

  test("passes prompt options to streamText and aggregates visible text deltas", async () => {
    const onTextDelta = mock(async () => {});
    const abortController = new AbortController();
    const usage = {
      inputTokens: 12,
      outputTokens: 18,
      totalTokens: 30,
    };
    const totalUsage = {
      inputTokens: 15,
      outputTokens: 25,
      totalTokens: 40,
    };

    streamText.mockImplementation((options) => {
      currentCallOptions = options;

      return buildStreamResult({
        chunks: [
          { type: "text-delta", text: "Hello\n<<<REQ" },
          { type: "reasoning-delta", text: "ignore" },
          { type: "text-delta", text: "UEST>>>\nrequest-a" },
          { type: "text-delta", text: "\nrequest-b" },
        ],
        usage,
        totalUsage,
      });
    });

    const transport = new Transport(buildServiceManager());
    const result = await transport.send("system prompt", "user prompt", {
      abortSignal: abortController.signal,
      maxOutputTokens: 128,
      onTextDelta,
    });

    expect(streamText).toHaveBeenCalledTimes(1);
    expect(currentCallOptions.system).toBe("system prompt");
    expect(currentCallOptions.prompt).toBe("user prompt");
    expect(currentCallOptions.abortSignal).toBe(abortController.signal);
    expect(currentCallOptions.maxOutputTokens).toBe(128);
    expect(onTextDelta.mock.calls.map(([textDelta]) => textDelta).join("")).toBe(
      "Hello",
    );
    expect(result).toEqual({
      text: "Hello",
      requestText: "request-a\nrequest-b",
      finishReason: "stop",
      usage,
      totalUsage,
    });
  });

  test("returns empty requestText when request marker is absent", async () => {
    streamText.mockImplementation((options) => {
      currentCallOptions = options;

      return buildStreamResult({
        chunks: [
          { type: "text-delta", text: "Hello" },
          { type: "text-delta", text: " World" },
        ],
      });
    });

    const transport = new Transport(buildServiceManager());
    const result = await transport.send("system prompt", "user prompt");

    expect(result.text).toBe("Hello World");
    expect(result.requestText).toBe("");
  });

  test("forwards provider errors through onError", async () => {
    const providerError = new Error("provider error");
    const onError = mock(async () => {});

    streamText.mockImplementation((options) => {
      currentCallOptions = options;
      options.onError?.({ error: providerError });
      return buildStreamResult();
    });

    const transport = new Transport(buildServiceManager());
    await transport.send("system prompt", "user prompt", {
      onError,
    });

    expect(onError).toHaveBeenCalledWith(providerError);
  });

  test("forwards consumeStream errors through onError", async () => {
    const streamError = new Error("stream error");
    const onError = mock(async () => {});

    streamText.mockImplementation((options) => {
      currentCallOptions = options;
      return buildStreamResult({
        consumeErrors: [streamError],
      });
    });

    const transport = new Transport(buildServiceManager());
    await transport.send("system prompt", "user prompt", {
      onError,
    });

    expect(onError).toHaveBeenCalledWith(streamError);
  });

  test("throws when runtime service is missing", () => {
    expect(() => {
      new Transport(new ServiceManager());
    }).toThrow("Runtime service not found");
  });

  test("supports openai provider when provider config is present", () => {
    expect(() => {
      new Transport(
        buildServiceManager({
          providerProfiles: {
            advanced: "deepseek/deepseek-chat",
            balanced: "openai/gpt-5",
            basic: "deepseek/deepseek-chat",
          },
          providers: {
            openai: {
              apiKeyEnv: "OPENAI_API_KEY",
              models: ["gpt-5"],
            },
          },
        }),
      );
    }).not.toThrow();
  });

  test("supports openaiCompatible provider when provider config is present", () => {
    expect(() => {
      new Transport(
        buildServiceManager({
          providerProfiles: {
            advanced: "deepseek/deepseek-chat",
            balanced: "openaiCompatible/custom-model",
            basic: "deepseek/deepseek-chat",
          },
          providers: {
            openaiCompatible: {
              apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
              baseUrl: "https://example.com/v1",
              models: ["custom-model"],
            },
          },
        }),
      );
    }).not.toThrow();
  });

  test("throws when openaiCompatible provider config is missing", () => {
    expect(() => {
      new Transport(
        buildServiceManager({
          providerProfiles: {
            advanced: "deepseek/deepseek-chat",
            balanced: "openaiCompatible/custom-model",
            basic: "deepseek/deepseek-chat",
          },
        }),
      );
    }).toThrow("Missing provider config: openaiCompatible");
  });
});
