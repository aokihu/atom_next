// @ts-nocheck
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
    eventTarget: overrides.eventTarget ?? undefined,
    payload: overrides.payload ?? [],
    channel: overrides.channel ?? { domain: "tui" },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  } as TaskItem;
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

  describe("priority-based task retrieval", () => {
    test("retrieves higher priority tasks first", async () => {
      const lowPriorityTask = buildTestTask("low", { priority: 3 });
      const mediumPriorityTask = buildTestTask("medium", { priority: 2 });
      const highPriorityTask = buildTestTask("high", { priority: 1 });

      // 添加顺序：低 -> 中 -> 高
      await taskQueue.addTask(lowPriorityTask);
      await taskQueue.addTask(mediumPriorityTask);
      await taskQueue.addTask(highPriorityTask);

      // 获取顺序应该是：高 -> 中 -> 低
      const task1 = await taskQueue.getWorkableTask();
      const task2 = await taskQueue.getWorkableTask();
      const task3 = await taskQueue.getWorkableTask();

      expect(task1?.id).toBe("high");
      expect(task2?.id).toBe("medium");
      expect(task3?.id).toBe("low");
    });

    test("maintains FIFO order within the same priority", async () => {
      const task1 = buildTestTask("task1", { priority: 2 });
      const task2 = buildTestTask("task2", { priority: 2 });
      const task3 = buildTestTask("task3", { priority: 2 });

      await taskQueue.addTask(task1);
      await taskQueue.addTask(task2);
      await taskQueue.addTask(task3);

      const retrieved1 = await taskQueue.getWorkableTask();
      const retrieved2 = await taskQueue.getWorkableTask();
      const retrieved3 = await taskQueue.getWorkableTask();

      expect(retrieved1?.id).toBe("task1");
      expect(retrieved2?.id).toBe("task2");
      expect(retrieved3?.id).toBe("task3");
    });

    test("handles mixed priorities correctly", async () => {
      await taskQueue.addTask(buildTestTask("p3-task1", { priority: 3 }));
      await taskQueue.addTask(buildTestTask("p1-task1", { priority: 1 }));
      await taskQueue.addTask(buildTestTask("p2-task1", { priority: 2 }));
      await taskQueue.addTask(buildTestTask("p1-task2", { priority: 1 }));
      await taskQueue.addTask(buildTestTask("p3-task2", { priority: 3 }));

      const retrievedIds = [];
      for (let i = 0; i < 5; i++) {
        const task = await taskQueue.getWorkableTask();
        if (task) retrievedIds.push(task.id);
      }

      // 所有 p1 任务应该最先，然后是 p2，最后是 p3
      // 在相同优先级内保持添加顺序
      expect(retrievedIds).toEqual([
        "p1-task1",
        "p1-task2",
        "p2-task1",
        "p3-task1",
        "p3-task2",
      ]);
    });

    test("skips empty priority queues", async () => {
      // 只添加优先级 1 和 3 的任务
      await taskQueue.addTask(buildTestTask("p3", { priority: 3 }));
      await taskQueue.addTask(buildTestTask("p1", { priority: 1 }));

      const task1 = await taskQueue.getWorkableTask();
      const task2 = await taskQueue.getWorkableTask();
      const task3 = await taskQueue.getWorkableTask();

      expect(task1?.id).toBe("p1");
      expect(task2?.id).toBe("p3");
      expect(task3).toBeUndefined();
    });
  });

  describe("updateTask", () => {
    test("updates task state successfully", async () => {
      const task = buildTaskItem({});
      await taskQueue.addTask(task);

      const newState = "processing";
      taskQueue.updateTask(task.id, { state: newState });

      expect(task.state).toBe(newState);
    });

    test("automatically updates updatedAt timestamp", async () => {
      const task = buildTaskItem({});
      const originalUpdatedAt = task.updatedAt;

      // 等待一小段时间确保时间戳不同
      await new Promise((resolve) => setTimeout(resolve, 1));

      await taskQueue.addTask(task);
      taskQueue.updateTask(task.id, { state: "updated" });

      expect(task.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });

    test("dispatches update-task event when eventTarget exists", async () => {
      let eventFired = false;
      const eventTarget = new EventTarget();

      eventTarget.addEventListener("update-task", () => {
        eventFired = true;
      });

      const task = buildTestTask("task-with-event", { eventTarget });
      await taskQueue.addTask(task);

      taskQueue.updateTask(task.id, { state: "updated" });

      expect(eventFired).toBe(true);
    });

    test("does not throw when task has no eventTarget", async () => {
      const task = buildTestTask("task-without-event", {
        eventTarget: undefined,
      });
      await taskQueue.addTask(task);

      expect(() => {
        taskQueue.updateTask(task.id, { state: "updated" });
      }).not.toThrow();
    });

    test("throws error when task not found", () => {
      expect(() => {
        taskQueue.updateTask("non-existent-id", {
          state: "test",
        });
      }).toThrow("Task not found: non-existent-id");
    });

    test("can find and update task in any priority queue", async () => {
      const highPriorityTask = buildTestTask("high-task", { priority: 1 });
      const lowPriorityTask = buildTestTask("low-task", { priority: 3 });

      await taskQueue.addTask(highPriorityTask);
      await taskQueue.addTask(lowPriorityTask);

      expect(() => {
        taskQueue.updateTask("high-task", { state: "processing-high" });
        taskQueue.updateTask("low-task", { state: "processing-low" });
      }).not.toThrow();

      expect(highPriorityTask.state).toBe("processing-high");
      expect(lowPriorityTask.state).toBe("processing-low");
    });
  });

  describe("multiple tasks operations", () => {
    test("handles multiple tasks correctly", async () => {
      const tasks = [
        buildTaskItem({ priority: 1 }),
        buildTaskItem({ priority: 2 }),
        buildTaskItem({ priority: 1 }),
      ];

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

    test("can interleave add and get operations", async () => {
      await taskQueue.addTask(buildTestTask("task1", { priority: 2 }));
      const task1 = await taskQueue.getWorkableTask();
      expect(task1?.id).toBe("task1");

      await taskQueue.addTask(buildTestTask("task2", { priority: 2 }));
      await taskQueue.addTask(buildTestTask("task3", { priority: 1 }));

      const task2 = await taskQueue.getWorkableTask();
      expect(task2?.id).toBe("task3"); // 优先级1的先出

      const task3 = await taskQueue.getWorkableTask();
      expect(task3?.id).toBe("task2");

      const task4 = await taskQueue.getWorkableTask();
      expect(task4).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    test("handles empty queue operations gracefully", async () => {
      const result = await taskQueue.getWorkableTask();
      expect(result).toBeUndefined();

      expect(() => {
        taskQueue.updateTask("invalid-id", { state: "test" });
      }).toThrow();
    });

    test("works with tasks created with buildTaskItem", async () => {
      const customTask = buildTaskItem({
        source: "internal",
        priority: 1,
        payload: [{ type: "text", data: "custom data" }],
      });

      await taskQueue.addTask(customTask);
      const retrieved = await taskQueue.getWorkableTask();

      expect(retrieved?.id).toEqual(customTask.id);
      expect(retrieved?.source).toBe("internal");
      expect(retrieved?.priority).toBe(1);
    });

    test("handles non-sequential priority numbers", async () => {
      await taskQueue.addTask(buildTestTask("p5", { priority: 5 }));
      await taskQueue.addTask(buildTestTask("p10", { priority: 10 }));
      await taskQueue.addTask(buildTestTask("p1", { priority: 1 }));

      const task1 = await taskQueue.getWorkableTask();
      const task2 = await taskQueue.getWorkableTask();
      const task3 = await taskQueue.getWorkableTask();

      expect(task1?.id).toBe("p1");
      expect(task2?.id).toBe("p5");
      expect(task3?.id).toBe("p10");
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

      const chain1Index1 = ids.indexOf("chain1-task1");
      const chain1Index2 = ids.indexOf("chain1-task2");
      expect(chain1Index2).toBe(chain1Index1 + 1);
    });

    test("handles chainId with tasks pushed in different order", async () => {
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

      expect(ids.indexOf("chainA-task1")).toBeLessThan(
        ids.indexOf("chainB-task1"),
      );
    });
  });
});
