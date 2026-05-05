/**
 * Pipeline event types.
 *
 * Defines two event namespaces on the shared PipelineEventBus:
 * - pipeline.element.* — lifecycle observation events emitted by PipelineRunner
 * - transport.*      — domain events emitted by the transport element
 */
import type {
  TransportToolCallFinishEvent,
  TransportToolCallStartEvent,
} from "../elements/transport.element";
import type { PipelineElementKind } from "./types";

/** Emitted before an element's process() is called. */
export type PipelineElementStartedEvent = {
  pipelineName: string;
  elementName: string;
  elementKind: PipelineElementKind;
};

/** Emitted after an element's process() completes successfully. */
export type PipelineElementFinishedEvent = {
  pipelineName: string;
  elementName: string;
  elementKind: PipelineElementKind;
  durationMs: number;
};

/** Emitted when an element's process() throws, before rethrowing. */
export type PipelineElementFailedEvent = {
  pipelineName: string;
  elementName: string;
  elementKind: PipelineElementKind;
  durationMs: number;
  error: unknown;
};

/** Typed event map consumed by PipelineEventBus. */
export type PipelineEventMap = {
  "pipeline.element.started": PipelineElementStartedEvent;
  "pipeline.element.finished": PipelineElementFinishedEvent;
  "pipeline.element.failed": PipelineElementFailedEvent;

  "transport.delta": {
    textDelta: string;
  };
  "transport.tool.started": TransportToolCallStartEvent;
  "transport.tool.finished": TransportToolCallFinishEvent;
  "transport.failed": {
    error: unknown;
  };
};
