import type { FinishReason, LanguageModelUsage } from "ai";
import { streamText } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { finished } from "node:stream/promises";
import type { ServiceManager } from "@/libs/service-manage";
import type { RuntimeService } from "@/services/runtime";
import { createModelWithProvider } from "./model";
import { createRequestStreamParser } from "./request-stream";

type SendOptions = {
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  onTextDelta?: (textDelta: string) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
};

type SendResult = {
  text: string;
  requestText: string;
  finishReason: FinishReason;
  usage: LanguageModelUsage;
  totalUsage: LanguageModelUsage;
};

/**
 * Core Transport
 * @class Transport
 * @description 提供上传提示词到LLM服务,并获取LLM结果
 */
export class Transport {
  #model: LanguageModelV3;

  #getRuntimeService(serviceManager: ServiceManager): RuntimeService {
    const runtime = serviceManager.getService<RuntimeService>("runtime");

    if (!runtime) {
      throw new Error("Runtime service not found");
    }

    return runtime;
  }

  constructor(serviceManager: ServiceManager) {
    const runtime = this.#getRuntimeService(serviceManager);
    const selectedModel = runtime.getModelProfileWithLevel("balanced");
    const providerConfig = runtime.getProviderConfig(selectedModel.provider);

    this.#model = createModelWithProvider(selectedModel, providerConfig);
  }

  public async send(
    systemPrompt: string,
    userPrompt: string,
    options: SendOptions = {},
  ): Promise<SendResult> {
    let text = "";
    const parser = createRequestStreamParser();

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
      model: this.#model,
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

    const [requestText, finishReason, usage, totalUsage] = await Promise.all([
      parser.requestText,
      result.finishReason,
      result.usage,
      result.totalUsage,
    ]);

    return {
      text,
      requestText,
      finishReason,
      usage,
      totalUsage,
    };
  }
}
