import { describe, expect, mock, test } from "bun:test";
import { runPipelineDefinition } from "@/core/pipeline/definitions";
import { PipelineRunner } from "@/core/pipeline";
import type { PipelineDefinition, PipelineResult } from "@/core/pipeline";
import type { TaskItem } from "@/types/task";
import { TaskState, TaskSource } from "@/types/task";

const buildTask = (id: string, overrides: Partial<TaskItem> = {}): TaskItem => {
  const now = Date.now();

  return {
    id,
    chainId: overrides.chainId ?? id,
    parentTaskId: overrides.parentTaskId ?? id,
    sessionId: overrides.sessionId ?? "session-1",
    chatId: overrides.chatId ?? "chat-1",
    state: overrides.state ?? TaskState.WAITING,
    source: overrides.source ?? TaskSource.EXTERNAL,
    pipeline: overrides.pipeline ?? "formal_conversation",
    priority: overrides.priority ?? 1,
    eventTarget: overrides.eventTarget ?? undefined,
    channel: overrides.channel ?? { domain: "tui" },
    payload: overrides.payload ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  } as unknown as TaskItem;
};

describe("runPipelineDefinition", () => {
  test("calls setup cleanup when pipeline element throws", async () => {
    let cleaned = false;

    const definition: PipelineDefinition<unknown, PipelineResult> = {
      name: "test",
      createInput: () => ({}),
      createPipeline: () => ({
        name: "test",
        elements: [
          {
            name: "ThrowElement",
            async process() {
              throw new Error("boom");
            },
          },
        ],
      }),
      setup: () => {
        return () => {
          cleaned = true;
        };
      },
    };

    const task = buildTask("task-1");
    const deps = {
      taskQueue: { updateTask: mock(() => {}), addTask: mock(async () => {}) } as any,
      runtime: {} as any,
      serviceManager: {} as any,
    };

    await expect(
      runPipelineDefinition(definition, task, deps, new PipelineRunner()),
    ).rejects.toThrow("boom");

    expect(cleaned).toBe(true);
  });

  test("calls setup cleanup on success", async () => {
    let cleaned = false;

    const definition: PipelineDefinition<unknown, PipelineResult> = {
      name: "test",
      createInput: () => ({}),
      createPipeline: () => ({
        name: "test",
        elements: [
          {
            name: "PassElement",
            async process() {
              return { type: "complete", task: buildTask("task-1") };
            },
          },
        ],
      }),
      setup: () => {
        return () => {
          cleaned = true;
        };
      },
    };

    const task = buildTask("task-1");
    const deps = {
      taskQueue: { updateTask: mock(() => {}), addTask: mock(async () => {}) } as any,
      runtime: {} as any,
      serviceManager: {} as any,
    };

    const result = await runPipelineDefinition(
      definition,
      task,
      deps,
      new PipelineRunner(),
    );

    expect(result).toEqual({ type: "complete", task });
    expect(cleaned).toBe(true);
  });
});
