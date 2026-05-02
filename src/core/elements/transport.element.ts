import type { PipelineElement } from "@/core/pipeline";
import type { TransportPort, TransportPayload, TransportOutput } from "@/core/transport/types";

type TransportElementInput = {
  transportPayload: TransportPayload;
};

type TransportElementOutput<TInput extends TransportElementInput> = TInput & {
  transportOutput: TransportOutput;
};

export const createTransportElement = <
  TInput extends TransportElementInput,
>(
  transport: TransportPort,
): PipelineElement<TInput, TransportElementOutput<TInput>> => {
  return {
    name: "Transport",
    async process(input, context) {
      const { transportPayload } = input;
      let hasReportedFailure = false;

      try {
        const transportOutput = await transport.send(
          transportPayload.systemPrompt,
          transportPayload.userPrompt,
          {
            ...transportPayload.options,
            onTextDelta: async (textDelta) => {
              await context.eventBus.emit("transport.delta", { textDelta });
            },
            onToolCallStart: async (event) => {
              await context.eventBus.emit("transport.tool.started", event);
            },
            onToolCallFinish: async (event) => {
              await context.eventBus.emit("transport.tool.finished", event);
            },
            onError: async (error) => {
              hasReportedFailure = true;
              await transportPayload.options?.onError?.(error);
              await context.eventBus.emit("transport.failed", { error });
            },
          },
        );

        return {
          ...input,
          transportOutput,
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
