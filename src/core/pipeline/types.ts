import type { TaskItem } from "@/types/task";
import type { ServiceManager } from "@/libs/service-manage";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";
import type { PipelineEventBus } from "./event-bus";
import type { PipelineEventMap } from "./events";

export type PipelineRunDeps = {
  taskQueue: TaskQueue;
  runtime: Runtime;
  serviceManager: ServiceManager;
};

export type PipelineSetupCleanup = () => void;

export type PipelineDefinition<TInput, TOutput> = {
  name: string;

  createInput(
    task: TaskItem,
    deps: PipelineRunDeps,
  ): TInput;

  createPipeline(
    deps: PipelineRunDeps,
  ): Pipeline<TInput, TOutput>;

  setup?(
    eventBus: PipelineEventBus<PipelineEventMap>,
    input: TInput,
    deps: PipelineRunDeps,
  ): void | PipelineSetupCleanup;
};

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

export type PipelineElementKind = "source" | "transform" | "boundary" | "sink";

export type PipelineElement<I, O> = {
  name: string;
  kind: PipelineElementKind;
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
