// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { buildTaskItem } from "@/core/queue/task";
import { TaskSource, TaskState, type TaskItem } from "@/types/task";

const createTask = (overrides = {}) =>
  buildTaskItem({
    sessionId: "session-1",
    chatId: "chat-1",
    ...overrides,
  });

describe("buildTaskItem", () => {
  test("creates a task with default values", () => {
    const task = createTask();

    expect(task.id).toBeDefined();
    expect(task.id.length).toBeGreaterThan(0);
    expect(task.chainId).toBe(task.id);
    expect(task.parentId).toBe(task.id);
    expect(task.source).toBe(TaskSource.EXTERNAL);
    expect(task.state).toBe(TaskState.WAITING);
    expect(task.priority).toBe(2);
    expect(task.payload).toEqual([]);
    expect(task.channel).toEqual({ domain: "tui" });
    expect(task.createdAt).toBeGreaterThan(0);
    expect(task.updatedAt).toBe(task.createdAt);
  });

  test("uses provided parameters", () => {
    const customPayload = [{ type: "text", data: "test" }];
    const customChannel = { domain: "gateway", source: "test-source" };

    const task = createTask({
      priority: 1,
      payload: customPayload,
      channel: customChannel,
    });

    expect(task.sessionId).toBe("session-1");
    expect(task.chatId).toBe("chat-1");
    expect(task.source).toBe(TaskSource.EXTERNAL);
    expect(task.priority).toBe(1);
    expect(task.payload).toEqual(customPayload);
    expect(task.channel).toEqual(customChannel);
  });

  test("generates unique IDs for each task", () => {
    const task1 = createTask();
    const task2 = createTask();

    expect(task1.id).not.toBe(task2.id);
  });

  test("allows modifying state property", () => {
    const task = createTask();
    const newState = TaskState.PROCESSING;

    expect(() => {
      task.state = newState;
    }).not.toThrow();

    expect(task.state).toBe(newState);
  });

  test("allows modifying updatedAt property", () => {
    const task = createTask();
    const newTime = Date.now() + 1000;

    expect(() => {
      task.updatedAt = newTime;
    }).not.toThrow();

    expect(task.updatedAt).toBe(newTime);
  });

  test("throws error when modifying readonly property id", () => {
    const task = createTask();

    expect(() => {
      (task as any).id = "new-id";
    }).toThrow("Attempted to assign to readonly property.");
  });

  test("throws error when modifying readonly property chainId", () => {
    const task = createTask();

    expect(() => {
      (task as any).chainId = "new-chain-id";
    }).toThrow("Attempted to assign to readonly property.");
  });

  test("throws error when modifying readonly property priority", () => {
    const task = createTask();

    expect(() => {
      (task as any).priority = 5;
    }).toThrow("Attempted to assign to readonly property.");
  });

  test("throws error when modifying readonly property source", () => {
    const task = createTask();

    expect(() => {
      (task as any).source = TaskSource.INTERNAL;
    }).toThrow("Attempted to assign to readonly property.");
  });

  test("throws error when modifying readonly property payload", () => {
    const task = createTask();

    expect(() => {
      (task as any).payload = [{ type: "text", data: "new" }];
    }).toThrow("Attempted to assign to readonly property.");
  });

  test("throws error when modifying readonly property channel", () => {
    const task = createTask();

    expect(() => {
      (task as any).channel = { domain: "gateway", source: "new" };
    }).toThrow("Attempted to assign to readonly property.");
  });

  test("throws error when modifying readonly property createdAt", () => {
    const task = createTask();

    expect(() => {
      (task as any).createdAt = 12345;
    }).toThrow("Attempted to assign to readonly property.");
  });

  test("can modify state and updatedAt together", () => {
    const task = createTask();
    const newState = TaskState.COMPLETE;
    const newTime = Date.now() + 5000;

    expect(() => {
      task.state = newState;
      task.updatedAt = newTime;
    }).not.toThrow();

    expect(task.state).toBe(newState);
    expect(task.updatedAt).toBe(newTime);
  });

  test("creates task with chainId same as id by default", () => {
    const task = createTask();
    expect(task.chainId).toBe(task.id);
  });

  test("creates task with parentId same as id by default", () => {
    const task = createTask();
    expect(task.parentId).toBe(task.id);
  });

  test("createdAt and updatedAt are set to current time", () => {
    const before = Date.now();
    const task = createTask();
    const after = Date.now();

    expect(task.createdAt).toBeGreaterThanOrEqual(before);
    expect(task.createdAt).toBeLessThanOrEqual(after);
    expect(task.updatedAt).toBe(task.createdAt);
  });

  test("always initializes root lineage from generated id", () => {
    const task = createTask();

    expect(task.chainId).toBe(task.id);
    expect(task.parentId).toBe(task.id);
  });
});
