import type { UUID } from "@/types";
import type { RuntimeEventBus } from "./event-bus";

export type PipelineRunMetadata = {
  taskId: UUID;
  chainId: UUID;
};

export type PipelineContext = {
  run: PipelineRunMetadata;
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

/**
 * 当前版本只提供 pipeline 输入输出层面的类型约束。
 * Element 链路连续性仍然是弱类型，后续可以引入 typed builder 强化 element chaining。
 */
export const createPipeline = <I, O>(
  pipeline: Pipeline<I, O>,
): Pipeline<I, O> => pipeline;
