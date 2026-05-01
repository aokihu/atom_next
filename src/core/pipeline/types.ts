import type { TaskItem } from "@/types/task";
import type { Runtime } from "../runtime";
import type { Transport } from "../transport";
import type { RuntimeEventBus } from "./event-bus";

export type PipelineContext = {
  task: TaskItem;
  runtime: Runtime;
  transport: Transport;
  eventBus: RuntimeEventBus;
  signal?: AbortSignal;
};

export type PipelineElement<I, O> = {
  name: string;
  process(input: I, context: PipelineContext): Promise<O>;
};

export type Pipeline<I, O> = {
  name: string;
  elements: Array<PipelineElement<any, any>>;
};
