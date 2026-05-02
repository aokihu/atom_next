import type {
  TransportToolCallFinishEvent,
  TransportToolCallStartEvent,
} from "@/core/transport/transport";

export type PipelineEventMap = {
  "transport.delta": {
    textDelta: string;
  };
  "transport.tool.started": TransportToolCallStartEvent;
  "transport.tool.finished": TransportToolCallFinishEvent;
  "transport.failed": {
    error: unknown;
  };
};
