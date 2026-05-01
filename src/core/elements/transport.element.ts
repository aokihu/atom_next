import type { PipelineElement } from "@/core/pipeline";
import type {
  TransportOutput,
  TransportPayload,
  TransportPort,
} from "@/core/transport";

export const createTransportElement = (
  transport: TransportPort,
): PipelineElement<TransportPayload, TransportOutput> => ({
  name: "transport",

  async process(input, context) {
    const options = input.options ?? {};
    const {
      onTextDelta,
      onToolCallStart,
      onToolCallFinish,
      ...restOptions
    } = options;

    try {
      return await transport.send(input.systemPrompt, input.userPrompt, {
        ...restOptions,
        onTextDelta: async (delta) => {
          context.eventBus.emit({
            type: "transport.delta",
            taskId: context.run.taskId,
            chainId: context.run.chainId,
            delta,
            createdAt: Date.now(),
          });
          await onTextDelta?.(delta);
        },
        onToolCallStart: async (event) => {
          context.eventBus.emit({
            type: "transport.tool.started",
            taskId: context.run.taskId,
            chainId: context.run.chainId,
            event,
            createdAt: Date.now(),
          });
          await onToolCallStart?.(event);
        },
        onToolCallFinish: async (event) => {
          context.eventBus.emit({
            type: "transport.tool.finished",
            taskId: context.run.taskId,
            chainId: context.run.chainId,
            event,
            createdAt: Date.now(),
          });
          await onToolCallFinish?.(event);
        },
      });
    } catch (error) {
      context.eventBus.emit({
        type: "transport.failed",
        taskId: context.run.taskId,
        chainId: context.run.chainId,
        error: error instanceof Error ? error.message : String(error),
        createdAt: Date.now(),
      });

      throw error;
    }
  },
});
