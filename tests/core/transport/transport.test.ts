// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";

const streamText = mock();
const generateText = mock();
const stepCountIs = mock((stepCount) => ({
  type: "step-count",
  stepCount,
}));

mock.module("ai", () => ({
  streamText,
  generateText,
  stepCountIs,
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
    generateText.mockReset();
    stepCountIs.mockClear();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_COMPATIBLE_API_KEY = "test-openai-compatible-key";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
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
    expect(currentCallOptions.tools).toBeUndefined();
    expect(currentCallOptions.stopWhen).toBeUndefined();
    expect(onTextDelta.mock.calls.map(([textDelta]) => textDelta).join("")).toBe(
      "Hello",
    );
    expect(result).toEqual({
      text: "Hello",
      intentRequestText: "request-a\nrequest-b",
      finishReason: "stop",
      usage,
      totalUsage,
    });
  });

  test("returns empty intentRequestText when request marker is absent", async () => {
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
    expect(result.intentRequestText).toBe("");
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

  test("passes tools and maxToolSteps to streamText and forwards tool hooks", async () => {
    const onToolCallStart = mock(async () => {});
    const onToolCallFinish = mock(async () => {});
    const tools = {
      read: {
        description: "read file",
        inputSchema: {},
      },
    };

    streamText.mockImplementation((options) => {
      currentCallOptions = options;

      return {
        consumeStream: async () => {
          await options.experimental_onToolCallStart?.({
            toolCall: {
              toolName: "read",
              toolCallId: "call_1",
              input: { filepath: "/tmp/readme.md" },
            },
          });

          await options.onChunk?.({
            chunk: { type: "text-delta", text: "Looked up file. " },
          });

          await options.experimental_onToolCallFinish?.({
            toolCall: {
              toolName: "read",
              toolCallId: "call_1",
              input: { filepath: "/tmp/readme.md" },
            },
            success: true,
            output: {
              filepath: "/tmp/readme.md",
              size: 12,
            },
          });

          await options.onChunk?.({
            chunk: { type: "text-delta", text: "Done." },
          });
        },
        finishReason: Promise.resolve("stop"),
        usage: Promise.resolve({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        }),
        totalUsage: Promise.resolve({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        }),
      };
    });

    const transport = new Transport(buildServiceManager());
    const result = await transport.send("system prompt", "user prompt", {
      tools,
      maxToolSteps: 7,
      onToolCallStart,
      onToolCallFinish,
    });

    expect(stepCountIs).toHaveBeenCalledTimes(1);
    expect(stepCountIs).toHaveBeenCalledWith(7);
    expect(currentCallOptions.tools).toBe(tools);
    expect(currentCallOptions.stopWhen).toEqual({
      type: "step-count",
      stepCount: 7,
    });
    expect(onToolCallStart).toHaveBeenCalledWith({
      toolName: "read",
      toolCallId: "call_1",
      input: { filepath: "/tmp/readme.md" },
    });
    expect(onToolCallFinish).toHaveBeenCalledWith({
      toolName: "read",
      toolCallId: "call_1",
      input: { filepath: "/tmp/readme.md" },
      result: {
        filepath: "/tmp/readme.md",
        size: 12,
      },
    });
    expect(result.text).toBe("Looked up file. Done.");
    expect(result.intentRequestText).toBe("");
  });

  test("uses default maxToolSteps when tools are present and keeps text parsing isolated from tool events", async () => {
    const onTextDelta = mock(async () => {});
    const onToolCallFinish = mock(async () => {});
    const tools = {
      tree: {
        description: "list tree",
        inputSchema: {},
      },
    };

    streamText.mockImplementation((options) => {
      currentCallOptions = options;

      return {
        consumeStream: async () => {
          await options.experimental_onToolCallStart?.({
            toolCall: {
              toolName: "tree",
              toolCallId: "call_2",
              input: { dirpath: "/tmp/project" },
            },
          });

          await options.onChunk?.({
            chunk: { type: "text-delta", text: "Summary\n<<<REQ" },
          });

          await options.experimental_onToolCallFinish?.({
            toolCall: {
              toolName: "tree",
              toolCallId: "call_2",
              input: { dirpath: "/tmp/project" },
            },
            success: false,
            error: new Error("tree failed"),
          });

          await options.onChunk?.({
            chunk: { type: "text-delta", text: "UEST>>>\nrequest-a" },
          });
        },
        finishReason: Promise.resolve("stop"),
        usage: Promise.resolve({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        }),
        totalUsage: Promise.resolve({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        }),
      };
    });

    const transport = new Transport(buildServiceManager());
    const result = await transport.send("system prompt", "user prompt", {
      tools,
      onTextDelta,
      onToolCallFinish,
    });

    expect(stepCountIs).toHaveBeenCalledTimes(1);
    expect(stepCountIs).toHaveBeenCalledWith(5);
    expect(currentCallOptions.stopWhen).toEqual({
      type: "step-count",
      stepCount: 5,
    });
    expect(onTextDelta.mock.calls.map(([textDelta]) => textDelta).join("")).toBe(
      "Summary",
    );
    expect(onToolCallFinish).toHaveBeenCalledWith({
      toolName: "tree",
      toolCallId: "call_2",
      input: { dirpath: "/tmp/project" },
      error: expect.any(Error),
    });
    expect(result.text).toBe("Summary");
    expect(result.intentRequestText).toBe("request-a");
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

  test("defers provider validation until send", () => {
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
    }).not.toThrow();
  });

  test("throws when openaiCompatible provider config is missing during send", async () => {
    const transport = new Transport(
      buildServiceManager({
        providerProfiles: {
          advanced: "deepseek/deepseek-chat",
          balanced: "openaiCompatible/custom-model",
          basic: "deepseek/deepseek-chat",
        },
      }),
    );

    await expect(
      transport.send("system prompt", "user prompt"),
    ).rejects.toThrow(
      "Invalid transport provider config: missing config.providers.openaiCompatible",
    );
    expect(streamText).not.toHaveBeenCalled();
  });

  test("throws when provider profile provider is unsupported during send", async () => {
    const transport = new Transport(
      buildServiceManager({
        providerProfiles: {
          advanced: "deepseek/deepseek-chat",
          balanced: "custom/model-x",
          basic: "deepseek/deepseek-chat",
        },
      }),
    );

    await expect(
      transport.send("system prompt", "user prompt"),
    ).rejects.toThrow(
      "Invalid transport model config: config.providerProfiles.balanced contains unsupported provider (custom)",
    );
    expect(streamText).not.toHaveBeenCalled();
  });

  test("supports forward-compatible openai model on default provider path during send", async () => {
    streamText.mockImplementation((options) => {
      currentCallOptions = options;

      return buildStreamResult({
        chunks: [{ type: "text-delta", text: "ok" }],
      });
    });

    const transport = new Transport(
      buildServiceManager({
        providerProfiles: {
          advanced: "deepseek/deepseek-chat",
          balanced: "openai/future-model",
          basic: "deepseek/deepseek-chat",
        },
      }),
    );

    const result = await transport.send("system prompt", "user prompt");

    expect(result.text).toBe("ok");
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  test("throws when providerConfig models does not include selected model", async () => {
    const transport = new Transport(
      buildServiceManager({
        providerProfiles: {
          advanced: "deepseek/deepseek-chat",
          balanced: "openai/gpt-5",
          basic: "deepseek/deepseek-chat",
        },
        providers: {
          openai: {
            apiKeyEnv: "OPENAI_API_KEY",
            models: ["gpt-4o"],
          },
        },
      }),
    );

    await expect(
      transport.send("system prompt", "user prompt"),
    ).rejects.toThrow(
      "config.providers.openai.models does not include gpt-5",
    );
    expect(streamText).not.toHaveBeenCalled();
  });

  test("throws when provider apiKey env is missing during send", async () => {
    delete process.env.OPENAI_API_KEY;

    const transport = new Transport(
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

    await expect(
      transport.send("system prompt", "user prompt"),
    ).rejects.toThrow(
      "Invalid transport provider config: config.providers.openai.apiKeyEnv points to missing env OPENAI_API_KEY",
    );
    expect(streamText).not.toHaveBeenCalled();
  });

  test("throws when openaiCompatible baseUrl is missing during send", async () => {
    const transport = new Transport(
      buildServiceManager({
        providerProfiles: {
          advanced: "deepseek/deepseek-chat",
          balanced: "openaiCompatible/custom-model",
          basic: "deepseek/deepseek-chat",
        },
        providers: {
          openaiCompatible: {
            apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
            models: ["custom-model"],
          },
        },
      }),
    );

    await expect(
      transport.send("system prompt", "user prompt"),
    ).rejects.toThrow(
      "Invalid transport provider config: missing config.providers.openaiCompatible.baseUrl for openaiCompatible",
    );
    expect(streamText).not.toHaveBeenCalled();
  });

  test("supports configured forward-compatible openai model during send", async () => {
    streamText.mockImplementation((options) => {
      currentCallOptions = options;

      return buildStreamResult({
        chunks: [{ type: "text-delta", text: "ok" }],
      });
    });

    const transport = new Transport(
      buildServiceManager({
        providerProfiles: {
          advanced: "deepseek/deepseek-chat",
          balanced: "openai/gpt-5.1",
          basic: "deepseek/deepseek-chat",
        },
        providers: {
          openai: {
            apiKeyEnv: "OPENAI_API_KEY",
            models: ["gpt-5.1"],
          },
        },
      }),
    );

    const result = await transport.send("system prompt", "user prompt");

    expect(result.text).toBe("ok");
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  test("supports openaiCompatible model ids with extra slashes during send", async () => {
    streamText.mockImplementation((options) => {
      currentCallOptions = options;

      return buildStreamResult({
        chunks: [{ type: "text-delta", text: "ok" }],
      });
    });

    const transport = new Transport(
      buildServiceManager({
        providerProfiles: {
          advanced: "deepseek/deepseek-chat",
          balanced: "openaiCompatible/meta-llama/Llama-3.3-70B-Instruct",
          basic: "deepseek/deepseek-chat",
        },
        providers: {
          openaiCompatible: {
            apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
            baseUrl: "https://example.com/v1",
            models: ["meta-llama/Llama-3.3-70B-Instruct"],
          },
        },
      }),
    );

    const result = await transport.send("system prompt", "user prompt");

    expect(result.text).toBe("ok");
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  test("forwards preflight model validation errors through onError", async () => {
    const onError = mock(async () => {});
    const transport = new Transport(
      buildServiceManager({
        providerProfiles: {
          advanced: "deepseek/deepseek-chat",
          balanced: "custom/model-x",
          basic: "deepseek/deepseek-chat",
        },
      }),
    );

    await expect(
      transport.send("system prompt", "user prompt", {
        onError,
      }),
    ).rejects.toThrow(
      "Invalid transport model config: config.providerProfiles.balanced contains unsupported provider (custom)",
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});

describe("Transport.generateText", () => {
  beforeEach(() => {
    generateText.mockReset();
    streamText.mockReset();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_COMPATIBLE_API_KEY = "test-openai-compatible-key";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  });

  test("passes prompt options to generateText and returns full text", async () => {
    const abortController = new AbortController();
    generateText.mockResolvedValue({
      text: "TYPE=unknown\nNEEDS_MEMORY=false",
    });

    const transport = new Transport(buildServiceManager());
    const result = await transport.generateText("system prompt", "user prompt", {
      abortSignal: abortController.signal,
      maxOutputTokens: 64,
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0]?.[0]?.system).toBe("system prompt");
    expect(generateText.mock.calls[0]?.[0]?.prompt).toBe("user prompt");
    expect(generateText.mock.calls[0]?.[0]?.abortSignal).toBe(
      abortController.signal,
    );
    expect(generateText.mock.calls[0]?.[0]?.maxOutputTokens).toBe(64);
    expect(result).toBe("TYPE=unknown\nNEEDS_MEMORY=false");
  });

  test("supports explicit model profile overrides", async () => {
    generateText.mockResolvedValue({
      text: "TYPE=memory_lookup",
    });

    const transport = new Transport(buildServiceManager());
    const result = await transport.generateText("system prompt", "user prompt", {
      modelProfile: {
        level: "basic",
        selectedModel: {
          id: "deepseek/deepseek-chat",
          provider: "deepseek",
          model: "deepseek-chat",
        },
      },
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0]?.[0]?.model).toBeDefined();
    expect(result).toBe("TYPE=memory_lookup");
  });
});
