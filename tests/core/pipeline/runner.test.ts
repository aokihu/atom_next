import { describe, expect, test } from "bun:test";
import {
  PipelineEventBus,
  PipelineRunner,
  type Pipeline,
  type PipelineEventMap,
} from "@/core/pipeline";

describe("PipelineRunner", () => {
  test("runs elements in order and passes output to the next element", async () => {
    const calls: string[] = [];
    const pipeline: Pipeline<number, number> = {
      name: "number-pipeline",
      elements: [
        {
          name: "add-one",
          async process(input) {
            calls.push(`first:${input}`);
            return input + 1;
          },
        },
        {
          name: "double",
          async process(input) {
            calls.push(`second:${input}`);
            return input * 2;
          },
        },
      ],
    };

    const runner = new PipelineRunner();
    const result = await runner.run(pipeline, 2, {
      task: { id: "task-1" } as any,
      eventBus: new PipelineEventBus<PipelineEventMap>(),
    });

    expect(result).toBe(6);
    expect(calls).toEqual(["first:2", "second:3"]);
  });

  test("throws AbortError when signal is aborted before the next element", async () => {
    const controller = new AbortController();
    const pipeline: Pipeline<number, number> = {
      name: "abort-pipeline",
      elements: [
        {
          name: "abort",
          async process(input) {
            controller.abort();
            return input + 1;
          },
        },
        {
          name: "never-runs",
          async process(input) {
            return input + 1;
          },
        },
      ],
    };

    const runner = new PipelineRunner();

    await expect(
      runner.run(pipeline, 1, {
        task: { id: "task-2" } as any,
        signal: controller.signal,
        eventBus: new PipelineEventBus<PipelineEventMap>(),
      }),
    ).rejects.toThrow("Pipeline aborted");
  });

  test("propagates element failure", async () => {
    const runner = new PipelineRunner();
    const pipeline: Pipeline<void, void> = {
      name: "failure-pipeline",
      elements: [
        {
          name: "explode",
          async process() {
            throw new Error("boom");
          },
        },
      ],
    };

    await expect(
      runner.run(pipeline, undefined, {
        task: { id: "task-3" } as any,
        eventBus: new PipelineEventBus<PipelineEventMap>(),
      }),
    ).rejects.toThrow("boom");
  });
});
