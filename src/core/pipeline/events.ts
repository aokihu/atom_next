import type {
  TransportToolCallFinishEvent,
  TransportToolCallStartEvent,
} from "../elements/transport.element";
import type { PipelineElementKind } from "./types";

export type PipelineElementStartedEvent = {
  pipelineName: string;
  elementName: string;
  elementKind: PipelineElementKind;
};

export type PipelineElementFinishedEvent = {
  pipelineName: string;
  elementName: string;
  elementKind: PipelineElementKind;
  durationMs: number;
};

export type PipelineElementFailedEvent = {
  pipelineName: string;
  elementName: string;
  elementKind: PipelineElementKind;
  durationMs: number;
  error: unknown;
};

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
