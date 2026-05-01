import { describe, expect, test } from "bun:test";
import { createTaskItem } from "@/libs/task";
import {
  PipelineRunner,
  RuntimeEventBus,
  type RuntimePipelineEvent,
} from "@/core/pipeline";

describe("PipelineRunner", () => {
  test("fails immediately with AbortError before pipeline starts", async () => {
    const task = createTaskItem({
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "hello" }],
    });
    const eventBus = new RuntimeEventBus();
    const events: RuntimePipelineEvent[] = [];
    const controller = new AbortController();
    const runner = new PipelineRunner();

    eventBus.onAny((event) => {
      events.push(event);
    });
    controller.abort();

    await expect(
      runner.run(
        {
          name: "test.pipeline",
          elements: [],
        },
        undefined,
        {
          run: {
            taskId: task.id,
            chainId: task.chainId,
          },
          eventBus,
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "Pipeline aborted",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "pipeline.failed",
      pipeline: "test.pipeline",
      taskId: task.id,
      chainId: task.chainId,
      error: "Pipeline aborted",
    });
  });

  test("fails with AbortError after an element aborts the signal", async () => {
    const task = createTaskItem({
      sessionId: "session-1",
      chatId: "chat-1",
      payload: [{ type: "text", data: "hello" }],
    });
    const eventBus = new RuntimeEventBus();
    const events: RuntimePipelineEvent[] = [];
    const controller = new AbortController();
    const runner = new PipelineRunner();

    eventBus.onAny((event) => {
      events.push(event);
    });

    await expect(
      runner.run(
        {
          name: "test.pipeline",
          elements: [
            {
              name: "aborter",
              async process(input: string) {
                controller.abort();
                return `${input}:processed`;
              },
            },
          ],
        },
        "input",
        {
          run: {
            taskId: task.id,
            chainId: task.chainId,
          },
          eventBus,
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "Pipeline aborted",
    });

    expect(events.map((event) => event.type)).toEqual([
      "pipeline.started",
      "pipeline.element.started",
      "pipeline.failed",
    ]);
  });
});
