import type { Pipeline, PipelineContext } from "./types";

const stringifyPipelineError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const createPipelineAbortError = () =>
  new DOMException("Pipeline aborted", "AbortError");

const throwIfPipelineAborted = (context: PipelineContext) => {
  if (context.signal?.aborted) {
    throw createPipelineAbortError();
  }
};

export class PipelineRunner {
  async run<I, O>(
    pipeline: Pipeline<I, O>,
    input: I,
    context: PipelineContext,
  ): Promise<O> {
    let current: unknown = input;

    try {
      throwIfPipelineAborted(context);

      context.eventBus.emit({
        type: "pipeline.started",
        pipeline: pipeline.name,
        taskId: context.run.taskId,
        chainId: context.run.chainId,
        createdAt: Date.now(),
      });

      for (const element of pipeline.elements) {
        throwIfPipelineAborted(context);

        context.eventBus.emit({
          type: "pipeline.element.started",
          pipeline: pipeline.name,
          element: element.name,
          taskId: context.run.taskId,
          chainId: context.run.chainId,
          createdAt: Date.now(),
        });

        try {
          current = await element.process(current, context);
        } catch (error) {
          context.eventBus.emit({
            type: "pipeline.element.failed",
            pipeline: pipeline.name,
            element: element.name,
            taskId: context.run.taskId,
            chainId: context.run.chainId,
            error: stringifyPipelineError(error),
            createdAt: Date.now(),
          });
          throw error;
        }

        throwIfPipelineAborted(context);

        context.eventBus.emit({
          type: "pipeline.element.completed",
          pipeline: pipeline.name,
          element: element.name,
          taskId: context.run.taskId,
          chainId: context.run.chainId,
          createdAt: Date.now(),
        });
      }

      throwIfPipelineAborted(context);

      context.eventBus.emit({
        type: "pipeline.completed",
        pipeline: pipeline.name,
        taskId: context.run.taskId,
        chainId: context.run.chainId,
        createdAt: Date.now(),
      });

      return current as O;
    } catch (error) {
      context.eventBus.emit({
        type: "pipeline.failed",
        pipeline: pipeline.name,
        taskId: context.run.taskId,
        chainId: context.run.chainId,
        error: stringifyPipelineError(error),
        createdAt: Date.now(),
      });
      throw error;
    }
  }
}
