import { streamText } from "ai";
import { finished } from "node:stream/promises";
import type { ServiceManager } from "@/libs/service-manage";
import type { PipelineElement } from "@/core/pipeline";
import {
  normalizePendingToolCalls,
  resolveTransportModel,
  resolveTransportToolStopCondition,
} from "@/core/transport/helpers";
import { createRequestStreamParser } from "@/core/transport/request-stream";
import type { TransportPayload, TransportOutput } from "@/core/transport/types";

type TransportElementDeps = {
  serviceManager: ServiceManager;
};

type TransportElementInput = {
  transportPayload: TransportPayload;
};

type TransportElementOutput<TInput extends TransportElementInput> = TInput & {
  transportOutput: TransportOutput;
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

export const createTransportElement = <
  TInput extends TransportElementInput,
>(
  deps: TransportElementDeps,
): PipelineElement<TInput, TransportElementOutput<TInput>> => {
  return {
    name: "Transport",
    async process(input, context) {
      const { transportPayload } = input;
      const transportOptions = transportPayload.options ?? {};
      let hasReportedFailure = false;
      let text = "";
      const parser = createRequestStreamParser();
      const stopWhen = resolveTransportToolStopCondition(transportOptions);
      let model;

      try {
        model = resolveTransportModel(
          deps.serviceManager,
          "stream",
          transportOptions.modelProfile,
        );
      } catch (error) {
        await context.eventBus.emit("transport.failed", { error });
        throw error;
      }

      const flushVisibleText = async () => {
        while (true) {
          const chunk = parser.read();

          if (chunk === null) {
            break;
          }

          const textDelta = String(chunk);
          text += textDelta;
          await context.eventBus.emit("transport.delta", { textDelta });
        }
      };

      try {
        const result = streamText({
          model,
          system: transportPayload.systemPrompt,
          prompt: transportPayload.userPrompt,
          abortSignal: transportOptions.abortSignal,
          maxOutputTokens: transportOptions.maxOutputTokens,
          ...(transportOptions.tools ? { tools: transportOptions.tools } : {}),
          ...(stopWhen ? { stopWhen } : {}),
          experimental_onToolCallStart: async (event: RawToolCallStartEvent) => {
            await context.eventBus.emit("transport.tool.started", {
              toolName: event.toolCall.toolName,
              toolCallId: event.toolCall.toolCallId,
              input: event.toolCall.input,
            });
          },
          experimental_onToolCallFinish: async (event: RawToolCallFinishEvent) => {
            await context.eventBus.emit("transport.tool.finished", {
              toolName: event.toolCall.toolName,
              toolCallId: event.toolCall.toolCallId,
              input: event.toolCall.input,
              ...(event.success
                ? { result: event.output }
                : { error: event.error }),
            });
          },
          onChunk: async ({ chunk }) => {
            if (chunk.type !== "text-delta") {
              return;
            }

            parser.write(chunk.text);
            await flushVisibleText();
          },
          onError: async ({ error }) => {
            hasReportedFailure = true;
            await context.eventBus.emit("transport.failed", { error });
          },
        });

        await result.consumeStream({
          onError: async (error) => {
            hasReportedFailure = true;
            await context.eventBus.emit("transport.failed", { error });
          },
        });

        parser.end();
        await finished(parser, { readable: false });
        await flushVisibleText();

        const [
          intentRequestText,
          finishReason,
          usage,
          totalUsage,
          steps,
          response,
        ] = await Promise.all([
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
          ...input,
          transportOutput: {
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
          },
        };
      } catch (error) {
        if (!hasReportedFailure) {
          await context.eventBus.emit("transport.failed", { error });
        }
        throw error;
      }
    },
  };
};
