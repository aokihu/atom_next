import type { Pipeline, PipelineContext } from "./types";

const stringifyPipelineError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

export class PipelineRunner {
  async run<I, O>(
    pipeline: Pipeline<I, O>,
    input: I,
    context: PipelineContext,
  ): Promise<O> {
    context.eventBus.emit({
      type: "pipeline.started",
      pipeline: pipeline.name,
      taskId: context.task.id,
      chainId: context.task.chainId,
      createdAt: Date.now(),
    });

    let current: unknown = input;

    try {
      for (const element of pipeline.elements) {
        context.eventBus.emit({
          type: "pipeline.element.started",
          pipeline: pipeline.name,
          element: element.name,
          taskId: context.task.id,
          chainId: context.task.chainId,
          createdAt: Date.now(),
        });

        try {
          current = await element.process(current, context);
        } catch (error) {
          context.eventBus.emit({
            type: "pipeline.element.failed",
            pipeline: pipeline.name,
            element: element.name,
            taskId: context.task.id,
            chainId: context.task.chainId,
            error: stringifyPipelineError(error),
            createdAt: Date.now(),
          });
          throw error;
        }

        context.eventBus.emit({
          type: "pipeline.element.completed",
          pipeline: pipeline.name,
          element: element.name,
          taskId: context.task.id,
          chainId: context.task.chainId,
          createdAt: Date.now(),
        });
      }

      context.eventBus.emit({
        type: "pipeline.completed",
        pipeline: pipeline.name,
        taskId: context.task.id,
        chainId: context.task.chainId,
        createdAt: Date.now(),
      });

      return current as O;
    } catch (error) {
      context.eventBus.emit({
        type: "pipeline.failed",
        pipeline: pipeline.name,
        taskId: context.task.id,
        chainId: context.task.chainId,
        error: stringifyPipelineError(error),
        createdAt: Date.now(),
      });
      throw error;
    }
  }
}
