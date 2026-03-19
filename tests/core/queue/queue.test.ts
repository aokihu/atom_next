import { describe, expect, test, beforeEach } from "bun:test";

import { TaskQueue } from "@/core/queue/queue";
import { buildTaskItem } from "@/core/queue/task";
import resort from "@/core/queue/resort";
import type { AppContext } from "@/types/app";
import type { TaskItem } from "@/types/queue";

// 创建一个简单的 AppContext
const mockAppContext: AppContext = {};

// 辅助函数：构建测试任务（不使用 Proxy 包装，方便测试）
const buildTestTask = (
  id: string,
  overrides: Partial<TaskItem> = {},
): TaskItem => {
  const now = Date.now();
  return {
    id,
    chainId: overrides.chainId ?? id,
    parentId: overrides.parentId ?? id,
    source: overrides.source ?? "external",
    state: overrides.state ?? "",
    priority: overrides.priority ?? 2,
    payload: overrides.payload ?? [],
    channel: overrides.channel ?? { domain: "tui" },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
};

describe("TaskQueue", () => {
  let taskQueue: TaskQueue;

  beforeEach(() => {
    taskQueue = new TaskQueue(mockAppContext);
  });

  describe("basic operations", () => {
    test("creates an empty queue", async () => {
      const task = await taskQueue.getWorkableTask();
      expect(task).toBeUndefined();
    });

    test("adds a task to the queue and retrieves it successfully", async () => {
      const task = buildTaskItem({});
      await taskQueue.addTask(task);

      const retrieved = await taskQueue.getWorkableTask();
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(task.id);
    });

    test("gets a normal workable task from queue", async () => {
      const normalTask = buildTaskItem({
        source: "external",
        priority: 2,
        payload: [{ type: "text", data: "Hello, this is a normal task" }],
        channel: { domain: "tui" },
      });

      await taskQueue.addTask(normalTask);
      const retrievedTask = await taskQueue.getWorkableTask();

      expect(retrievedTask).toBeDefined();
      expect(retrievedTask?.id).toBe(normalTask.id);
      expect(retrievedTask?.source).toBe("external");
      expect(retrievedTask?.priority).toBe(2);
    });

    test("returns undefined when queue is empty after retrieving all tasks", async () => {
      const task = buildTaskItem({});
      await taskQueue.addTask(task);

      await taskQueue.getWorkableTask();
      const empty = await taskQueue.getWorkableTask();

      expect(empty).toBeUndefined();
    });
  });

  describe("updateTask", () => {
    test("updates task state successfully", async () => {
      const task = buildTaskItem({});
      await taskQueue.addTask(task);

      const newState = "processing";
      taskQueue.updateTask(task.id, { state: newState, updatedAt: Date.now() });

      expect(task.state).toBe(newState);
    });

    test("updates task updatedAt successfully", async () => {
      const task = buildTaskItem({});
      const originalUpdatedAt = task.updatedAt;
      await taskQueue.addTask(task);

      const newUpdatedAt = Date.now() + 1000;
      taskQueue.updateTask(task.id, { state: "", updatedAt: newUpdatedAt });

      expect(task.updatedAt).toBe(newUpdatedAt);
      expect(task.updatedAt).not.toBe(originalUpdatedAt);
    });

    test("throws error when task not found", () => {
      expect(() => {
        taskQueue.updateTask("non-existent-id", {
          state: "test",
          updatedAt: Date.now(),
        });
      }).toThrow("Task not found: non-existent-id");
    });
  });

  describe("resort behavior", () => {
    test("RESORT_INTERVAL is set to 500ms", () => {
      expect(TaskQueue.RESORT_INTERVAL).toBe(500);
    });
  });

  describe("multiple tasks operations", () => {
    test("handles multiple tasks correctly", async () => {
      const tasks = [buildTaskItem({}), buildTaskItem({}), buildTaskItem({})];

      for (const task of tasks) {
        await taskQueue.addTask(task);
      }

      const retrievedTasks = [];
      for (let i = 0; i < tasks.length; i++) {
        const task = await taskQueue.getWorkableTask();
        if (task) retrievedTasks.push(task);
      }

      expect(retrievedTasks.length).toBe(tasks.length);
    });
  });
});

describe("resort function - priority and chainId tests", () => {
  describe("priority sorting", () => {
    test("sorts tasks by priority ascending (smaller number first)", async () => {
      const items = [
        buildTestTask("task-3", { priority: 3 }),
        buildTestTask("task-1", { priority: 1 }),
        buildTestTask("task-2", { priority: 2 }),
      ];

      const result = await resort(items);
      expect(result.map((item) => item.id)).toEqual([
        "task-1",
        "task-2",
        "task-3",
      ]);
    });

    test("sorts by createdAt when priorities are equal", async () => {
      const items = [
        buildTestTask("task-b", { priority: 2, createdAt: 200 }),
        buildTestTask("task-a", { priority: 2, createdAt: 100 }),
        buildTestTask("task-c", { priority: 2, createdAt: 300 }),
      ];

      const result = await resort(items);
      expect(result.map((item) => item.id)).toEqual([
        "task-a",
        "task-b",
        "task-c",
      ]);
    });

    test("sorts by updatedAt when priorities and createdAt are equal", async () => {
      const items = [
        buildTestTask("task-b", {
          priority: 2,
          createdAt: 100,
          updatedAt: 200,
        }),
        buildTestTask("task-a", {
          priority: 2,
          createdAt: 100,
          updatedAt: 100,
        }),
      ];

      const result = await resort(items);
      expect(result.map((item) => item.id)).toEqual(["task-a", "task-b"]);
    });

    test("sorts by original index when all other fields are equal", async () => {
      const items = [
        buildTestTask("task-2", {
          priority: 2,
          createdAt: 100,
          updatedAt: 100,
        }),
        buildTestTask("task-1", {
          priority: 2,
          createdAt: 100,
          updatedAt: 100,
        }),
      ];

      const result = await resort(items);
      expect(result.map((item) => item.id)).toEqual(["task-2", "task-1"]);
    });
  });

  describe("chainId sorting", () => {
    test("keeps same chainId tasks together", async () => {
      const items = [
        buildTestTask("root", { chainId: "root", priority: 2, createdAt: 100 }),
        buildTestTask("other", {
          chainId: "other",
          priority: 2,
          createdAt: 200,
        }),
        buildTestTask("child", {
          chainId: "root",
          parentId: "root",
          priority: 2,
          createdAt: 150,
        }),
      ];

      const result = await resort(items);
      expect(result.map((item) => item.id)).toEqual(["root", "child", "other"]);
    });

    test("compacts same-chain tasks ahead of same priority tasks", async () => {
      const items = [
        buildTestTask("root", { chainId: "root", priority: 2, createdAt: 100 }),
        buildTestTask("other", {
          chainId: "other",
          priority: 2,
          createdAt: 200,
        }),
        buildTestTask("child", {
          chainId: "root",
          parentId: "root",
          priority: 2,
          createdAt: 150,
        }),
      ];

      const result = await resort(items);
      expect(result.map((item) => item.id)).toEqual(["root", "child", "other"]);
    });

    test("compacts same-chain tasks even if child has lower priority", async () => {
      const items = [
        buildTestTask("root", { chainId: "root", priority: 2, createdAt: 100 }),
        buildTestTask("other", {
          chainId: "other",
          priority: 2,
          createdAt: 200,
        }),
        buildTestTask("child", {
          chainId: "root",
          parentId: "root",
          priority: 3,
          createdAt: 150,
        }),
      ];

      const result = await resort(items);
      expect(result.map((item) => item.id)).toEqual(["root", "child", "other"]);
    });

    test("does not move chain ahead of higher priority tasks", async () => {
      const items = [
        buildTestTask("root", { chainId: "root", priority: 2 }),
        buildTestTask("urgent", { chainId: "urgent", priority: 1 }),
        buildTestTask("child", {
          chainId: "root",
          parentId: "root",
          priority: 2,
        }),
      ];

      const result = await resort(items);
      expect(result.map((item) => item.id)).toEqual([
        "urgent",
        "root",
        "child",
      ]);
    });

    test("handles parent-child relationships correctly in same chain", async () => {
      const items = [
        buildTestTask("child2", {
          chainId: "chain1",
          parentId: "child1",
          priority: 2,
        }),
        buildTestTask("root", { chainId: "chain1", priority: 2 }),
        buildTestTask("child1", {
          chainId: "chain1",
          parentId: "root",
          priority: 2,
        }),
      ];

      const result = await resort(items);
      expect(result.map((item) => item.id)).toEqual([
        "root",
        "child1",
        "child2",
      ]);
    });

    test("handles multiple independent chains", async () => {
      const items = [
        buildTestTask("chain2-task", { chainId: "chain2", priority: 2 }),
        buildTestTask("chain1-task2", {
          chainId: "chain1",
          parentId: "chain1-task1",
          priority: 2,
        }),
        buildTestTask("chain1-task1", { chainId: "chain1", priority: 2 }),
      ];

      const result = await resort(items);
      const ids = result.map((item) => item.id);

      // Check that chain1 tasks are together and in order
      const chain1Index1 = ids.indexOf("chain1-task1");
      const chain1Index2 = ids.indexOf("chain1-task2");
      expect(chain1Index2).toBe(chain1Index1 + 1);
    });

    test("handles chainId with tasks pushed in different order", async () => {
      // Scenario from the comments: same chain tasks with other task in between
      const items = [
        buildTestTask("ID1", { chainId: "ID1", priority: 2 }),
        buildTestTask("ID2", { chainId: "ID2", priority: 2 }),
        buildTestTask("ID3", { chainId: "ID1", parentId: "ID1", priority: 2 }),
      ];

      const result = await resort(items);
      expect(result.map((item) => item.id)).toEqual(["ID1", "ID3", "ID2"]);
    });

    test("handles orphan nodes in chain", async () => {
      const items = [
        buildTestTask("orphan", {
          chainId: "chain1",
          parentId: "non-existent",
          priority: 2,
        }),
        buildTestTask("root", { chainId: "chain1", priority: 2 }),
      ];

      const result = await resort(items);
      const ids = result.map((item) => item.id);

      // Both should appear in the result
      expect(ids).toContain("root");
      expect(ids).toContain("orphan");
    });
  });

  describe("mixed priority and chainId scenarios", () => {
    test("prioritizes high priority over chain grouping", async () => {
      const items = [
        buildTestTask("chain1-low", { chainId: "chain1", priority: 3 }),
        buildTestTask("high-priority", { chainId: "single", priority: 1 }),
        buildTestTask("chain1-high", { chainId: "chain1", priority: 2 }),
      ];

      const result = await resort(items);
      expect(result[0].id).toBe("high-priority");
    });

    test("same priority chains ordered by first task's position", async () => {
      const items = [
        buildTestTask("chainB-task1", {
          chainId: "chainB",
          priority: 2,
          createdAt: 200,
        }),
        buildTestTask("chainA-task1", {
          chainId: "chainA",
          priority: 2,
          createdAt: 100,
        }),
        buildTestTask("chainA-task2", {
          chainId: "chainA",
          parentId: "chainA-task1",
          priority: 2,
        }),
      ];

      const result = await resort(items);
      const ids = result.map((item) => item.id);

      // chainA should come first because its first task has earlier createdAt
      expect(ids.indexOf("chainA-task1")).toBeLessThan(
        ids.indexOf("chainB-task1"),
      );
    });
  });
});
