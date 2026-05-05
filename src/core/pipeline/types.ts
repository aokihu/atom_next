/**
 * Pipeline core types.
 *
 * Defines the foundational contracts for the GStreamer-like pipeline model:
 * every task enters a single pipeline, which runs through an ordered chain
 * of elements and produces a PipelineResult consumed by Core.
 */
import type { TaskItem } from "@/types/task";
import type { ServiceManager } from "@/libs/service-manage";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";
import type { PipelineEventBus } from "./event-bus";
import type { PipelineEventMap } from "./events";

/**
 * Dependencies passed into every pipeline definition at creation time.
 */
export type PipelineRunDeps = {
  taskQueue: TaskQueue;
  runtime: Runtime;
  serviceManager: ServiceManager;
};

/**
 * Runtime environment shared by all pipeline elements.
 */
export type PipelineEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
};

export const createPipelineEnv = (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
): PipelineEnv => {
  return {
    task,
    taskQueue,
    runtime,
  };
};

/**
 * Cleanup callback returned by optional pipeline setup hooks.
 */
export type PipelineSetupCleanup = () => void;

/**
 * Statically-registered pipeline definition.
 *
 * Each pipeline is a compile-time known processing chain:
 * createInput builds the pipeline-specific input from the task,
 * createPipeline assembles the ordered element array,
 * and the optional setup hook registers event handlers for the run.
 */
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

/**
 * Core-semantic enqueue transition.
 *
 * "follow_up" = same task chain continues (current task enters FOLLOW_UP).
 * "dispatch"  = current task is done and spawns an independent next task (DISPATCHED).
 */
export type PipelineEnqueueTransition = "follow_up" | "dispatch";

/**
 * Terminal result produced by a pipeline.
 *
 * complete = current task finished, no further work.
 * enqueue  = current task produced a follow-up or dispatch nextTask.
 */
export type PipelineResult =
  | {
      type: "complete";
      task: TaskItem;
    }
  | {
      type: "enqueue";
      transition: PipelineEnqueueTransition;
      task: TaskItem;
      nextTask: TaskItem;
    };

/**
 * Execution context passed to every PipelineElement.process().
 */
export type PipelineContext = {
  task: TaskItem;
  signal?: AbortSignal;
  eventBus: PipelineEventBus<PipelineEventMap>;
};

/**
 * Pipeline element kind.
 *
 * source:
 *   Prepares initial pipeline input or binds runtime context.
 *   Must not produce PipelineResult or final task transition.
 *
 * transform:
 *   Converts one pipeline stage into another or executes non-final business work.
 *   Should not decide final complete/enqueue transition.
 *
 * boundary:
 *   May intercept current FlowState and switch it to ready_to_finalize.
 *   Decides finalization intent but must not mutate TaskQueue final state.
 *
 * sink:
 *   Accepts ready_to_finalize and returns PipelineResult.
 *   It is the terminal element of a pipeline.
 */
export type PipelineElementKind = "source" | "transform" | "boundary" | "sink";

/**
 * Single processing node inside a pipeline.
 *
 * Each element has a name, a semantic kind, and an async process method.
 * Element chain typing is intentionally weak in the current phase —
 * the Pipeline type holds elements as any-any to avoid a typed builder.
 */
export type PipelineElement<I, O> = {
  name: string;
  kind: PipelineElementKind;
  process(input: I, context: PipelineContext): Promise<O>;
};

/**
 * Ordered list of elements that form a processing chain.
 *
 * Element chain typing is intentionally weak in the current phase.
 * Do not introduce a typed builder yet.
 */
export type Pipeline<I, O> = {
  name: string;
  elements: Array<PipelineElement<any, any>>;
};
