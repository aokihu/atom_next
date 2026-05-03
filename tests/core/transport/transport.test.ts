// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";

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
  generateText,
  Output: {
    object: outputObject,
  },
  stepCountIs,
  streamText: mock(),
}));

const {
  DEFAULT_MAX_TOOL_STEPS,
  generateTransportObject,
  generateTransportText,
  normalizePendingToolCalls,
  resolveTransportModel,
  resolveTransportToolStopCondition,
} = await import("@/core/elements/transport.element");

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

describe("transport helpers", () => {
  beforeEach(() => {
    generateText.mockReset();
    outputObject.mockClear();
    stepCountIs.mockClear();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_COMPATIBLE_API_KEY = "test-openai-compatible-key";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  });

  test("generateTransportText passes prompt options to generateText and returns text", async () => {
    const abortController = new AbortController();
    generateText.mockResolvedValue({
      text: "TYPE=unknown\nNEEDS_MEMORY=false",
    });

    const result = await generateTransportText(
      buildServiceManager(),
      "system prompt",
      "user prompt",
      {
        abortSignal: abortController.signal,
        maxOutputTokens: 64,
      },
    );

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0]?.[0]?.system).toBe("system prompt");
    expect(generateText.mock.calls[0]?.[0]?.prompt).toBe("user prompt");
    expect(generateText.mock.calls[0]?.[0]?.abortSignal).toBe(
      abortController.signal,
    );
    expect(generateText.mock.calls[0]?.[0]?.maxOutputTokens).toBe(64);
    expect(result).toBe("TYPE=unknown\nNEEDS_MEMORY=false");
  });

  test("generateTransportText supports explicit model profile overrides", async () => {
    generateText.mockResolvedValue({
      text: "TYPE=memory_lookup",
    });

    const result = await generateTransportText(
      buildServiceManager(),
      "system prompt",
      "user prompt",
      {
        modelProfile: {
          level: "basic",
          selectedModel: {
            id: "deepseek/deepseek-chat",
            provider: "deepseek",
            model: "deepseek-chat",
          },
        },
      },
    );

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0]?.[0]?.model).toBeDefined();
    expect(result).toBe("TYPE=memory_lookup");
  });

  test("generateTransportObject passes schema options to generateText and returns structured output", async () => {
    const abortController = new AbortController();
    const schema = {
      safeParse: () => ({ success: true }),
    };

    generateText.mockResolvedValue({
      output: {
        type: "memory_lookup",
        topicRelation: "related",
      },
    });

    const result = await generateTransportObject(
      buildServiceManager(),
      "system prompt",
      "user prompt",
      {
        abortSignal: abortController.signal,
        maxOutputTokens: 96,
        schema,
        schemaName: "intent_prediction",
        schemaDescription: "prediction output",
      },
    );

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0]?.[0]?.system).toBe("system prompt");
    expect(generateText.mock.calls[0]?.[0]?.prompt).toBe("user prompt");
    expect(generateText.mock.calls[0]?.[0]?.abortSignal).toBe(
      abortController.signal,
    );
    expect(generateText.mock.calls[0]?.[0]?.maxOutputTokens).toBe(96);
    expect(outputObject).toHaveBeenCalledWith({
      schema,
      name: "intent_prediction",
      description: "prediction output",
    });
    expect(result).toEqual({
      type: "memory_lookup",
      topicRelation: "related",
    });
  });

  test("resolveTransportToolStopCondition returns undefined without tools", () => {
    expect(
      resolveTransportToolStopCondition({
        maxToolSteps: 7,
      }),
    ).toBeUndefined();
    expect(stepCountIs).not.toHaveBeenCalled();
  });

  test("resolveTransportToolStopCondition uses default and explicit maxToolSteps", () => {
    const tools = {
      read: {
        description: "read file",
        inputSchema: {},
      },
    };

    expect(
      resolveTransportToolStopCondition({
        tools,
      }),
    ).toEqual({
      type: "step-count",
      stepCount: DEFAULT_MAX_TOOL_STEPS,
    });
    expect(
      resolveTransportToolStopCondition({
        tools,
        maxToolSteps: 9,
      }),
    ).toEqual({
      type: "step-count",
      stepCount: 9,
    });
  });

  test("normalizePendingToolCalls returns last-step tool calls only for tool-calls finish reason", () => {
    expect(
      normalizePendingToolCalls(
        [
          {
            toolCalls: [
              {
                toolName: "read",
                toolCallId: "call-1",
                input: { filepath: "/tmp/a" },
              },
            ],
          },
          {
            toolCalls: [
              {
                toolName: "write",
                toolCallId: "call-2",
                args: { filepath: "/tmp/b" },
              },
              {
                toolName: "",
                toolCallId: "call-3",
                input: {},
              },
            ],
          },
        ],
        "tool-calls",
      ),
    ).toEqual([
      {
        toolName: "write",
        toolCallId: "call-2",
        input: { filepath: "/tmp/b" },
      },
    ]);

    expect(
      normalizePendingToolCalls(
        [
          {
            toolCalls: [
              {
                toolName: "read",
                input: {},
              },
            ],
          },
        ],
        "stop",
      ),
    ).toEqual([]);
  });

  test("resolveTransportModel caches by serviceManager", () => {
    const serviceManager = buildServiceManager();

    const firstModel = resolveTransportModel(serviceManager, "text");
    const secondModel = resolveTransportModel(serviceManager, "text");

    expect(firstModel).toBe(secondModel);
  });

  test("generateTransportText throws when runtime service is missing", async () => {
    await expect(
      generateTransportText(
        new ServiceManager(),
        "system prompt",
        "user prompt",
      ),
    ).rejects.toThrow("Runtime service not found");
  });

  test("generateTransportText throws when provider profile provider is unsupported", async () => {
    await expect(
      generateTransportText(
        buildServiceManager({
          providerProfiles: {
            advanced: "deepseek/deepseek-chat",
            balanced: "custom/model-x",
            basic: "deepseek/deepseek-chat",
          },
        }),
        "system prompt",
        "user prompt",
      ),
    ).rejects.toThrow(
      "Invalid transport model config: config.providerProfiles.balanced contains unsupported provider (custom)",
    );
  });
});
