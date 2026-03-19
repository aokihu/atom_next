// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { buildTaskItem } from "@/core/queue/task";
import type { TaskItem } from "@/types/queue";

describe("buildTaskItem", () => {
  test("creates a task with default values", () => {
    const task = buildTaskItem({});

    expect(task.id).toBeDefined();
    expect(task.id.length).toBeGreaterThan(0);
    expect(task.chainId).toBe(task.id);
    expect(task.parentId).toBe(task.id);
    expect(task.source).toBe("external");
    expect(task.state).toBe("");
    expect(task.priority).toBe(2);
    expect(task.payload).toEqual([]);
    expect(task.channel).toEqual({ domain: "tui" });
    expect(task.createdAt).toBeGreaterThan(0);
    expect(task.updatedAt).toBe(task.createdAt);
  });

  test("uses provided parameters", () => {
    const now = Date.now() - 1000;
    const customPayload = [{ type: "text", data: "test" }];
    const customChannel = { domain: "gateway", source: "test-source" };

    const task = buildTaskItem({
      chainId: "custom-chain-id",
      parentId: "custom-parent-id",
      source: "internal",
      priority: 1,
      payload: customPayload,
      channel: customChannel,
    });

    expect(task.chainId).toBe("custom-chain-id");
    expect(task.parentId).toBe("custom-parent-id");
    expect(task.source).toBe("internal");
    expect(task.priority).toBe(1);
    expect(task.payload).toEqual(customPayload);
    expect(task.channel).toEqual(customChannel);
  });

  test("generates unique IDs for each task", () => {
    const task1 = buildTaskItem({});
    const task2 = buildTaskItem({});

    expect(task1.id).not.toBe(task2.id);
  });

  test("allows modifying state property", () => {
    const task = buildTaskItem({});
    const newState = "processing";

    expect(() => {
      task.state = newState;
    }).not.toThrow();

    expect(task.state).toBe(newState);
  });

  test("allows modifying updatedAt property", () => {
    const task = buildTaskItem({});
    const newTime = Date.now() + 1000;

    expect(() => {
      task.updatedAt = newTime;
    }).not.toThrow();

    expect(task.updatedAt).toBe(newTime);
  });

  test("throws error when modifying readonly property id", () => {
    const task = buildTaskItem({});

    expect(() => {
      (task as any).id = "new-id";
    }).toThrow(
      "Cannot modify property 'id': only updatedAt and state can be modified",
    );
  });

  test("throws error when modifying readonly property chainId", () => {
    const task = buildTaskItem({});

    expect(() => {
      (task as any).chainId = "new-chain-id";
    }).toThrow(
      "Cannot modify property 'chainId': only updatedAt and state can be modified",
    );
  });

  test("throws error when modifying readonly property priority", () => {
    const task = buildTaskItem({});

    expect(() => {
      (task as any).priority = 5;
    }).toThrow(
      "Cannot modify property 'priority': only updatedAt and state can be modified",
    );
  });

  test("throws error when modifying readonly property source", () => {
    const task = buildTaskItem({});

    expect(() => {
      (task as any).source = "internal";
    }).toThrow(
      "Cannot modify property 'source': only updatedAt and state can be modified",
    );
  });

  test("throws error when modifying readonly property payload", () => {
    const task = buildTaskItem({});

    expect(() => {
      (task as any).payload = [{ type: "text", data: "new" }];
    }).toThrow(
      "Cannot modify property 'payload': only updatedAt and state can be modified",
    );
  });

  test("throws error when modifying readonly property channel", () => {
    const task = buildTaskItem({});

    expect(() => {
      (task as any).channel = { domain: "gateway", source: "new" };
    }).toThrow(
      "Cannot modify property 'channel': only updatedAt and state can be modified",
    );
  });

  test("throws error when modifying readonly property createdAt", () => {
    const task = buildTaskItem({});

    expect(() => {
      (task as any).createdAt = 12345;
    }).toThrow(
      "Cannot modify property 'createdAt': only updatedAt and state can be modified",
    );
  });

  test("can modify state and updatedAt together", () => {
    const task = buildTaskItem({});
    const newState = "completed";
    const newTime = Date.now() + 5000;

    expect(() => {
      task.state = newState;
      task.updatedAt = newTime;
    }).not.toThrow();

    expect(task.state).toBe(newState);
    expect(task.updatedAt).toBe(newTime);
  });

  test("creates task with chainId same as id by default", () => {
    const task = buildTaskItem({});
    expect(task.chainId).toBe(task.id);
  });

  test("creates task with parentId same as id by default", () => {
    const task = buildTaskItem({});
    expect(task.parentId).toBe(task.id);
  });

  test("createdAt and updatedAt are set to current time", () => {
    const before = Date.now();
    const task = buildTaskItem({});
    const after = Date.now();

    expect(task.createdAt).toBeGreaterThanOrEqual(before);
    expect(task.createdAt).toBeLessThanOrEqual(after);
    expect(task.updatedAt).toBe(task.createdAt);
  });

  test("preserves custom chainId while generating new id", () => {
    const customChainId = "my-chain-123";
    const task = buildTaskItem({ chainId: customChainId });

    expect(task.id).not.toBe(customChainId);
    expect(task.chainId).toBe(customChainId);
  });
});
