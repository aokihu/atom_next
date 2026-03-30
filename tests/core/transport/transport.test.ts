//@ts-nockeck
// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

const streamText = mock();

mock.module("ai", () => ({
  streamText,
}));

const { Transport } = await import("@/core/transport/transport");

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

    const transport = new Transport();
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

    const transport = new Transport();
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

    const transport = new Transport();
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

    const transport = new Transport();
    await transport.send("system prompt", "user prompt", {
      onError,
    });

    expect(onError).toHaveBeenCalledWith(streamError);
  });
});
