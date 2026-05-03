import type { Pipeline, PipelineContext } from "./types";

export class PipelineRunner {
  async run<I, O>(
    pipeline: Pipeline<I, O>,
    input: I,
    context: PipelineContext,
  ): Promise<O> {
    let current: unknown = input;

    for (const element of pipeline.elements) {
      if (context.signal?.aborted) {
        throw new DOMException("Pipeline aborted", "AbortError");
      }

      const startedAt = performance.now();

      context.eventBus.emit("pipeline.element.started", {
        pipelineName: pipeline.name,
        elementName: element.name,
        elementKind: element.kind,
      });

      try {
        current = await element.process(current, context);

        context.eventBus.emit("pipeline.element.finished", {
          pipelineName: pipeline.name,
          elementName: element.name,
          elementKind: element.kind,
          durationMs: performance.now() - startedAt,
        });
      } catch (error) {
        context.eventBus.emit("pipeline.element.failed", {
          pipelineName: pipeline.name,
          elementName: element.name,
          elementKind: element.kind,
          durationMs: performance.now() - startedAt,
          error,
        });

        throw error;
      }
    }

    return current as O;
  }
}
