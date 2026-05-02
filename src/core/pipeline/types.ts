import type { TaskItem } from "@/types/task";
import type { PipelineEventBus } from "./event-bus";
import type { PipelineEventMap } from "./events";

export type PipelineResult =
  | {
      type: "complete";
      task: TaskItem;
    }
  | {
      type: "enqueue";
      nextTask: TaskItem;
    };

export type PipelineContext = {
  task: TaskItem;
  signal?: AbortSignal;
  eventBus: PipelineEventBus<PipelineEventMap>;
};

export type PipelineElement<I, O> = {
  name: string;
  process(input: I, context: PipelineContext): Promise<O>;
};

/**
 * Current Pipeline type only validates pipeline-level input/output.
 * Element chain typing is intentionally weak in Phase 1.
 * Do not introduce a typed builder yet.
 */
export type Pipeline<I, O> = {
  name: string;
  elements: Array<PipelineElement<any, any>>;
};
