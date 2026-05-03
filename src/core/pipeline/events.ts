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
  "pipeline.lifecycle.element.started": PipelineElementStartedEvent;
  "pipeline.lifecycle.element.finished": PipelineElementFinishedEvent;
  "pipeline.lifecycle.element.failed": PipelineElementFailedEvent;

  "transport.delta": {
    textDelta: string;
  };
  "transport.tool.started": TransportToolCallStartEvent;
  "transport.tool.finished": TransportToolCallFinishEvent;
  "transport.failed": {
    error: unknown;
  };
};
