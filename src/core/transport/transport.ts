import type { FinishReason, LanguageModelUsage } from "ai";
import {
  generateText as runGenerateText,
  Output,
  stepCountIs,
  streamText,
} from "ai";
import { finished } from "node:stream/promises";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ZodType } from "zod";
import type { ServiceManager } from "@/libs/service-manage";
import type { RuntimeService } from "@/services/runtime";
import type { ToolDefinitionMap } from "@/services/tools";
import type {
  ParsedProviderModel,
  ProviderDefinition,
  ProviderProfileLevel,
} from "@/types/config";
import { createModelWithProvider } from "./model";
import { createRequestStreamParser } from "./request-stream";

export type TransportModelProfile = {
  level?: ProviderProfileLevel;
  selectedModel: ParsedProviderModel;
  providerConfig?: ProviderDefinition;
};

const DEFAULT_MAX_TOOL_STEPS = 5;

/**
 * Transport 层对外暴露的最小工具开始事件。
 * @description
 * 这里只保留 Runtime 未来真正需要消费的稳定字段，
 * 避免把 AI SDK 的实验性事件结构直接传到 Core 上层。
 */
export type TransportToolCallStartEvent = {
  toolName: string;
  toolCallId?: string;
  input: unknown;
};

/**
 * Transport 层对外暴露的最小工具结束事件。
 * @description
 * Transport 只转发执行结果，不解释成功/失败语义，
 * 更高层摘要仍由 ToolService wrapper / Runtime 处理。
 */
export type TransportToolCallFinishEvent = {
  toolName: string;
  toolCallId?: string;
  input: unknown;
  result?: unknown;
  error?: unknown;
};

export type TransportPendingToolCall = {
  toolName: string;
  toolCallId?: string;
  input: unknown;
};

type SendOptions = {
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  modelProfile?: TransportModelProfile;
  tools?: ToolDefinitionMap;
  maxToolSteps?: number;
  onTextDelta?: (textDelta: string) => void | Promise<void>;
  onToolCallStart?: (
    event: TransportToolCallStartEvent,
  ) => void | Promise<void>;
  onToolCallFinish?: (
    event: TransportToolCallFinishEvent,
  ) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
};

type GenerateTextOptions = {
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  modelProfile?: TransportModelProfile;
};

type GenerateObjectOptions<TOutput> = GenerateTextOptions & {
  schema: ZodType<TOutput>;
  schemaName?: string;
  schemaDescription?: string;
};

type SendResult = {
  text: string;
  intentRequestText: string;
  finishReason: FinishReason;
  usage: LanguageModelUsage;
  totalUsage: LanguageModelUsage;
  stepCount: number;
  toolCallCount: number;
  toolResultCount: number;
  responseMessageCount: number;
  pendingToolCalls: TransportPendingToolCall[];
};

type TransportModelCache = {
  key: string;
  model: LanguageModelV3;
};

type RawToolCallPayload = {
  toolName: string;
  toolCallId?: string;
  input: unknown;
};

type RawToolCallStartEvent = {
  toolCall: RawToolCallPayload;
};

type RawToolCallFinishEvent = {
  toolCall: RawToolCallPayload;
} & (
  | {
      success: true;
      output: unknown;
    }
  | {
      success: false;
      error: unknown;
    }
);

type RawStepToolCall = {
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  args?: unknown;
};

const normalizePendingToolCalls = (steps: Array<{
  toolCalls: RawStepToolCall[];
}>, finishReason: FinishReason): TransportPendingToolCall[] => {
  if (finishReason !== "tool-calls" || steps.length === 0) {
    return [];
  }

  const lastStep = steps[steps.length - 1];

  return lastStep.toolCalls
    .map((toolCall) => {
      const toolName = toolCall.toolName;

      if (typeof toolName !== "string" || toolName.trim() === "") {
        return null;
      }

      return {
        toolName,
        ...(typeof toolCall.toolCallId === "string"
          ? { toolCallId: toolCall.toolCallId }
          : {}),
        input: toolCall.input ?? toolCall.args ?? {},
      } satisfies TransportPendingToolCall;
    })
    .filter((toolCall): toolCall is TransportPendingToolCall => toolCall !== null);
};

/**
 * Core Transport
 * @class Transport
 * @description 提供上传提示词到LLM服务,并获取LLM结果
 */
export class Transport {
  #runtime: RuntimeService;
  #streamModelCache: TransportModelCache | null;
  #textModelCache: TransportModelCache | null;

  #getRuntimeService(serviceManager: ServiceManager): RuntimeService {
    const runtime = serviceManager.getService<RuntimeService>("runtime");

    if (!runtime) {
      throw new Error("Runtime service not found");
    }

    return runtime;
  }

  #createTransportModel(modelProfile: TransportModelProfile) {
    const profilePath = modelProfile.level
      ? `config.providerProfiles.${modelProfile.level}`
      : "transport.modelProfile";

    return createModelWithProvider(
      modelProfile.selectedModel,
      modelProfile.providerConfig,
      profilePath,
    );
  }

  #buildModelCacheKey(modelProfile: TransportModelProfile) {
    return JSON.stringify({
      level: modelProfile.level ?? "",
      modelId: modelProfile.selectedModel.id,
      providerConfig: modelProfile.providerConfig ?? null,
    });
  }

  #createBalancedModelProfile(): TransportModelProfile {
    return {
      level: "balanced",
      ...this.#runtime.getModelProfileConfigWithLevel("balanced"),
    };
  }

  #resolveModel(kind: "stream" | "text", modelProfile?: TransportModelProfile) {
    const cache =
      kind === "stream" ? this.#streamModelCache : this.#textModelCache;
    const setCache = (nextCache: TransportModelCache) => {
      if (kind === "stream") {
        this.#streamModelCache = nextCache;
        return;
      }

      this.#textModelCache = nextCache;
    };

    if (!modelProfile) {
      if (cache) {
        return cache.model;
      }

      const fallbackProfile = this.#createBalancedModelProfile();
      const nextCache = {
        key: this.#buildModelCacheKey(fallbackProfile),
        model: this.#createTransportModel(fallbackProfile),
      } satisfies TransportModelCache;

      setCache(nextCache);
      return nextCache.model;
    }

    const cacheKey = this.#buildModelCacheKey(modelProfile);

    if (cache?.key === cacheKey) {
      return cache.model;
    }

    const nextCache = {
      key: cacheKey,
      model: this.#createTransportModel(modelProfile),
    } satisfies TransportModelCache;

    setCache(nextCache);
    return nextCache.model;
  }

  constructor(serviceManager: ServiceManager) {
    this.#runtime = this.#getRuntimeService(serviceManager);
    this.#streamModelCache = null;
    this.#textModelCache = null;
  }

  /**
   * 只在启用 tools 时显式下发 stopWhen。
   * @description
   * 无 tools 场景继续沿用当前单轮文本调用语义，
   * 避免这一步把既有 send 行为一起改大。
   */
  #resolveToolStopCondition(options: SendOptions) {
    if (!options.tools) {
      return undefined;
    }

    return stepCountIs(options.maxToolSteps ?? DEFAULT_MAX_TOOL_STEPS);
  }

  public async send(
    systemPrompt: string,
    userPrompt: string,
    options: SendOptions = {},
  ): Promise<SendResult> {
    let text = "";
    const parser = createRequestStreamParser();
    const stopWhen = this.#resolveToolStopCondition(options);
    let model;

    try {
      model = this.#resolveModel("stream", options.modelProfile);
    } catch (error) {
      await options.onError?.(error);
      throw error;
    }

    /**
     * 这里不把 Transform 切到 flowing 模式，而是手动 drain readable buffer。
     *
     * 原因是 onTextDelta 支持异步回调，如果直接挂 data 事件，
     * 就很难保证“解析输出顺序”和“用户回调完成顺序”保持一致。
     * 手动 drain 可以让每个原始 chunk 的可见文本处理保持串行。
     */
    const flushVisibleText = async () => {
      while (true) {
        const chunk = parser.read();
        if (chunk === null) break;

        const textDelta = String(chunk);
        text += textDelta;
        await options.onTextDelta?.(textDelta);
      }
    };

    const result = streamText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: options.abortSignal,
      maxOutputTokens: options.maxOutputTokens,
      ...(options.tools ? { tools: options.tools } : {}),
      ...(stopWhen ? { stopWhen } : {}),
      ...(options.onToolCallStart
        ? {
            experimental_onToolCallStart: async (
              event: RawToolCallStartEvent,
            ) => {
              await options.onToolCallStart?.({
                toolName: event.toolCall.toolName,
                toolCallId: event.toolCall.toolCallId,
                input: event.toolCall.input,
              });
            },
          }
        : {}),
      ...(options.onToolCallFinish
        ? {
            experimental_onToolCallFinish: async (
              event: RawToolCallFinishEvent,
            ) => {
              await options.onToolCallFinish?.({
                toolName: event.toolCall.toolName,
                toolCallId: event.toolCall.toolCallId,
                input: event.toolCall.input,
                ...(event.success
                  ? { result: event.output }
                  : { error: event.error }),
              });
            },
          }
        : {}),
      onChunk: async ({ chunk }) => {
        if (chunk.type !== "text-delta") return;

        parser.write(chunk.text);
        await flushVisibleText();
      },
      onError: async ({ error }) => {
        await options.onError?.(error);
      },
    });

    await result.consumeStream({
      onError: async (error) => {
        await options.onError?.(error);
      },
    });

    parser.end();
    await finished(parser, { readable: false });
    await flushVisibleText();

    const [intentRequestText, finishReason, usage, totalUsage, steps, response] =
      await Promise.all([
        parser.intentRequestText,
        result.finishReason,
        result.usage,
        result.totalUsage,
        result.steps,
        result.response,
      ]);

    const stepCount = steps.length;
    const toolCallCount = steps.reduce((count, step) => {
      return count + step.toolCalls.length;
    }, 0);
    const toolResultCount = steps.reduce((count, step) => {
      return count + step.toolResults.length;
    }, 0);

    return {
      text,
      intentRequestText,
      finishReason,
      usage,
      totalUsage,
      stepCount,
      toolCallCount,
      toolResultCount,
      responseMessageCount: response.messages.length,
      pendingToolCalls: normalizePendingToolCalls(steps, finishReason),
    };
  }

  public async generateText(
    systemPrompt: string,
    userPrompt: string,
    options: GenerateTextOptions = {},
  ) {
    const model = this.#resolveModel("text", options.modelProfile);
    const result = await runGenerateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: options.abortSignal,
      maxOutputTokens: options.maxOutputTokens,
    });

    return result.text;
  }

  public async generateObject<TOutput>(
    systemPrompt: string,
    userPrompt: string,
    options: GenerateObjectOptions<TOutput>,
  ): Promise<TOutput> {
    const model = this.#resolveModel("text", options.modelProfile);
    const result = await runGenerateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: options.abortSignal,
      maxOutputTokens: options.maxOutputTokens,
      output: Output.object({
        schema: options.schema,
        ...(options.schemaName ? { name: options.schemaName } : {}),
        ...(options.schemaDescription
          ? { description: options.schemaDescription }
          : {}),
      }),
    });

    return result.output;
  }
}
