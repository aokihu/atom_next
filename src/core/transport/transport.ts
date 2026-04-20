import type { FinishReason, LanguageModelUsage } from "ai";
import { generateText as runGenerateText, streamText } from "ai";
import { finished } from "node:stream/promises";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ServiceManager } from "@/libs/service-manage";
import type { RuntimeService } from "@/services/runtime";
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

type SendOptions = {
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  modelProfile?: TransportModelProfile;
  onTextDelta?: (textDelta: string) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
};

type GenerateTextOptions = {
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  modelProfile?: TransportModelProfile;
};

type SendResult = {
  text: string;
  intentRequestText: string;
  finishReason: FinishReason;
  usage: LanguageModelUsage;
  totalUsage: LanguageModelUsage;
};

type TransportModelCache = {
  key: string;
  model: LanguageModelV3;
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

  #resolveModel(
    kind: "stream" | "text",
    modelProfile?: TransportModelProfile,
  ) {
    const cache = kind === "stream"
      ? this.#streamModelCache
      : this.#textModelCache;
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

  public async send(
    systemPrompt: string,
    userPrompt: string,
    options: SendOptions = {},
  ): Promise<SendResult> {
    let text = "";
    const parser = createRequestStreamParser();
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

    const [intentRequestText, finishReason, usage, totalUsage] = await Promise.all([
      parser.intentRequestText,
      result.finishReason,
      result.usage,
      result.totalUsage,
    ]);

    return {
      text,
      intentRequestText,
      finishReason,
      usage,
      totalUsage,
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
}
