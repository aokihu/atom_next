import { describe, expect, test } from "bun:test";
import {
  PipelineEventBus,
  PipelineRunner,
  type Pipeline,
  type PipelineElementKind,
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
          kind: "transform",
          async process(input) {
            calls.push(`first:${input}`);
            return input + 1;
          },
        },
        {
          name: "double",
          kind: "transform",
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
          kind: "transform",
          async process(input) {
            controller.abort();
            return input + 1;
          },
        },
        {
          name: "never-runs",
          kind: "transform",
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
          kind: "transform",
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

  test("emits element started and finished lifecycle events in order", async () => {
    const eventBus = new PipelineEventBus<PipelineEventMap>();
    const events: string[] = [];

    eventBus.on("pipeline.lifecycle.element.started", (payload) => {
      events.push(`started:${payload.elementName}:${payload.elementKind}`);
    });

    eventBus.on("pipeline.lifecycle.element.finished", (payload) => {
      events.push(`finished:${payload.elementName}:${payload.elementKind}`);
      expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    });

    const pipeline: Pipeline<string, string> = {
      name: "LifecyclePipeline",
      elements: [
        {
          name: "Prepare",
          kind: "source",
          async process(input: string) {
            return `${input}:prepared`;
          },
        },
        {
          name: "Finalize",
          kind: "sink",
          async process(input: string) {
            return `${input}:done`;
          },
        },
      ],
    };

    const task = { id: "task-lifecycle" } as any;
    const result = await new PipelineRunner().run(pipeline, "input", {
      task,
      eventBus,
    });

    expect(result).toBe("input:prepared:done");
    expect(events).toEqual([
      "started:Prepare:source",
      "finished:Prepare:source",
      "started:Finalize:sink",
      "finished:Finalize:sink",
    ]);
  });

  test("emits element failed lifecycle event before rethrowing", async () => {
    const eventBus = new PipelineEventBus<PipelineEventMap>();
    const failedEvents: string[] = [];

    eventBus.on("pipeline.lifecycle.element.failed", (payload) => {
      failedEvents.push(`${payload.elementName}:${payload.elementKind}`);
      expect(payload.durationMs).toBeGreaterThanOrEqual(0);
      expect(payload.error).toBeInstanceOf(Error);
    });

    const pipeline: Pipeline<string, string> = {
      name: "FailPipeline",
      elements: [
        {
          name: "FailingElement",
          kind: "transform",
          async process() {
            throw new Error("boom");
          },
        },
      ],
    };

    await expect(
      new PipelineRunner().run(pipeline, "input", {
        task: { id: "task-fail" } as any,
        eventBus,
      }),
    ).rejects.toThrow("boom");

    expect(failedEvents).toEqual(["FailingElement:transform"]);
  });
});
