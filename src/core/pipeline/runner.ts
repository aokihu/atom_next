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

      current = await element.process(current, context);
    }

    return current as O;
  }
}
