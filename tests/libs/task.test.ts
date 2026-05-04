import { describe, expect, test } from "bun:test";
import { createTaskItem, createInternalTaskItem } from "@/libs/task";
import { TaskPipeline } from "@/types/task";
import { createFormalConversationTask, createContinuationFormalConversationTask } from "@/core/runtime/intent-request/execution-helpers";

describe("Task builder followUpPolicy propagation", () => {
  test("createTaskItem preserves followUpPolicy", () => {
    const task = createTaskItem({
      sessionId: Bun.randomUUIDv7(),
      chatId: Bun.randomUUIDv7(),
      followUpPolicy: {
        mode: "maybe",
        reason: "long_output",
      },
    });

    expect(task.followUpPolicy).toEqual({
      mode: "maybe",
      reason: "long_output",
    });
  });

  test("createInternalTaskItem preserves followUpPolicy", () => {
    const chainId = Bun.randomUUIDv7();
    const parentTaskId = Bun.randomUUIDv7();

    const task = createInternalTaskItem({
      sessionId: Bun.randomUUIDv7(),
      chatId: Bun.randomUUIDv7(),
      chainId,
      parentTaskId,
      followUpPolicy: {
        mode: "maybe",
        reason: "long_output",
      },
    });

    expect(task.followUpPolicy).toEqual({
      mode: "maybe",
      reason: "long_output",
    });
  });

  test("createFormalConversationTask preserves explicit followUpPolicy", () => {
    const rootTask = createTaskItem({
      sessionId: Bun.randomUUIDv7(),
      chatId: Bun.randomUUIDv7(),
    });

    const nextTask = createFormalConversationTask(rootTask, {
      mode: "maybe",
      reason: "long_output",
    });

    expect(nextTask.followUpPolicy).toEqual({
      mode: "maybe",
      reason: "long_output",
    });
  });

  test("createContinuationFormalConversationTask inherits followUpPolicy from parent", () => {
    const rootTask = createTaskItem({
      sessionId: Bun.randomUUIDv7(),
      chatId: Bun.randomUUIDv7(),
      followUpPolicy: {
        mode: "maybe",
        reason: "long_output",
      },
    });

    const nextTask = createContinuationFormalConversationTask(rootTask);

    expect(nextTask.followUpPolicy).toEqual({
      mode: "maybe",
      reason: "long_output",
    });
  });
});
