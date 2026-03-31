// @ts-nocheck
import { describe, expect, test, beforeEach } from "bun:test";
import { EventEmitter } from "node:events";

import { TaskQueue } from "@/core/queue/queue";
import { buildTaskItem } from "@/core/queue/task";
import resort from "@/core/queue/resort";
import type { AppContext } from "@/types/app";
import { ChatStatus } from "@/types/chat";
import { ChatEvents } from "@/types/event";
import { TaskSource, TaskState, type TaskItem } from "@/types/task";

// 创建一个简单的 AppContext
const mockAppContext: AppContext = {};

const createTask = (overrides = {}) =>
  buildTaskItem({
    sessionId: "session-1",
    chatId: "chat-1",
    ...overrides,
  });

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
    sessionId: overrides.sessionId ?? `session-${id}`,
    chatId: overrides.chatId ?? `chat-${id}`,
    source: overrides.source ?? TaskSource.EXTERNAL,
    state: overrides.state ?? TaskState.WAITING,
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
      const task = await taskQueue.activateWorkableTask();
      expect(task).toBeUndefined();
    });

    test("adds a task to the queue and retrieves it successfully", async () => {
      const task = createTask();
      await taskQueue.addTask(task);

      const retrieved = await taskQueue.activateWorkableTask();
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(task.id);
    });

    test("gets a normal workable task from queue", async () => {
      const normalTask = buildTaskItem({
        sessionId: "session-normal",
        chatId: "chat-normal",
        priority: 2,
        payload: [{ type: "text", data: "Hello, this is a normal task" }],
        channel: { domain: "tui" },
      });

      await taskQueue.addTask(normalTask);
      const retrievedTask = await taskQueue.activateWorkableTask();

      expect(retrievedTask).toBeDefined();
      expect(retrievedTask?.id).toBe(normalTask.id);
      expect(retrievedTask?.source).toBe(TaskSource.EXTERNAL);
      expect(retrievedTask?.priority).toBe(2);
    });

    test("returns undefined when queue is empty after retrieving all tasks", async () => {
      const task = createTask();
      await taskQueue.addTask(task);

      await taskQueue.activateWorkableTask();
      const empty = await taskQueue.activateWorkableTask();

      expect(empty).toBeUndefined();
    });

    test("emits chat-enqueued when adding an external task", async () => {
      const eventTarget = new EventEmitter();
      const events = [];
      const task = buildTestTask("task-with-event", { eventTarget });

      eventTarget.on(ChatEvents.CHAT_ENQUEUED, (payload) => {
        events.push(payload);
      });

      await taskQueue.addTask(task);

      expect(events).toEqual([
        expect.objectContaining({ status: ChatStatus.WAITING }),
      ]);
    });

    test("does not emit chat-enqueued when adding an internal task", async () => {
      const eventTarget = new EventEmitter();
      const events = [];
      const task = buildTestTask("internal-task", {
        eventTarget,
        source: TaskSource.INTERNAL,
      });

      eventTarget.on(ChatEvents.CHAT_ENQUEUED, (payload) => {
        events.push(payload);
      });

      await taskQueue.addTask(task);

      expect(events).toHaveLength(0);
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
      const task1 = await taskQueue.activateWorkableTask();
      const task2 = await taskQueue.activateWorkableTask();
      const task3 = await taskQueue.activateWorkableTask();

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

      const retrieved1 = await taskQueue.activateWorkableTask();
      const retrieved2 = await taskQueue.activateWorkableTask();
      const retrieved3 = await taskQueue.activateWorkableTask();

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
        const task = await taskQueue.activateWorkableTask();
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

      const task1 = await taskQueue.activateWorkableTask();
      const task2 = await taskQueue.activateWorkableTask();
      const task3 = await taskQueue.activateWorkableTask();

      expect(task1?.id).toBe("p1");
      expect(task2?.id).toBe("p3");
      expect(task3).toBeUndefined();
    });
  });

  describe("updateTask", () => {
    test("updates task state successfully", async () => {
      const task = createTask();
      await taskQueue.addTask(task);

      const newState = TaskState.PROCESSING;
      taskQueue.updateTask(task.id, { state: newState });

      expect(task.state).toBe(newState);
    });

    test("automatically updates updatedAt timestamp", async () => {
      const task = createTask();
      const originalUpdatedAt = task.updatedAt;

      // 等待一小段时间确保时间戳不同
      await new Promise((resolve) => setTimeout(resolve, 1));

      await taskQueue.addTask(task);
      taskQueue.updateTask(task.id, { state: TaskState.PROCESSING });

      expect(task.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });

    test("does not emit queue lifecycle events when task state becomes processing", async () => {
      const eventTarget = new EventEmitter();
      const events = [];
      const task = buildTestTask("task-with-event", { eventTarget });

      eventTarget.on(ChatEvents.CHAT_ACTIVATED, (payload) => {
        events.push(payload);
      });

      await taskQueue.addTask(task);
      taskQueue.updateTask(task.id, { state: TaskState.PROCESSING });

      expect(events).toEqual([]);
    });

    test("emits chat-completed when task state becomes complete", async () => {
      const eventTarget = new EventEmitter();
      const events = [];
      const task = buildTestTask("task-complete", { eventTarget });

      eventTarget.on(ChatEvents.CHAT_COMPLETED, (payload) => {
        events.push(payload);
      });

      await taskQueue.addTask(task);
      // 直接更新到 COMPLETE 只验证事件类型，不验证 message 结构。
      // Core 在真实流程里会在发出 CHAT_COMPLETED 前补齐最终 message。
      task.message = {
        createdAt: Date.now(),
        data: "done",
      };
      taskQueue.updateTask(task.id, { state: TaskState.COMPLETE });

      expect(events).toEqual([
        expect.objectContaining({ status: ChatStatus.COMPLETE }),
      ]);
    });

    test("emits chat-failed when task state becomes failed", async () => {
      const eventTarget = new EventEmitter();
      const events = [];
      const task = buildTestTask("task-failed", { eventTarget });

      eventTarget.on(ChatEvents.CHAT_FAILED, (payload) => {
        events.push(payload);
      });

      await taskQueue.addTask(task);
      task.error = {
        message: "boom",
      };
      taskQueue.updateTask(task.id, { state: TaskState.FAILED });

      expect(events).toEqual([
        expect.objectContaining({ status: ChatStatus.FAILED }),
      ]);
    });

    test("does not emit events when shouldSyncEvent is false", async () => {
      const eventTarget = new EventEmitter();
      const completedEvents = [];
      const failedEvents = [];
      const task = buildTestTask("silent-task", { eventTarget });

      eventTarget.on(ChatEvents.CHAT_COMPLETED, (payload) => {
        completedEvents.push(payload);
      });
      eventTarget.on(ChatEvents.CHAT_FAILED, (payload) => {
        failedEvents.push(payload);
      });

      await taskQueue.addTask(task);
      task.message = {
        createdAt: Date.now(),
        data: "done",
      };
      taskQueue.updateTask(
        task.id,
        { state: TaskState.COMPLETE },
        { shouldSyncEvent: false },
      );

      expect(completedEvents).toEqual([]);
      expect(failedEvents).toEqual([]);
    });

    test("does not throw when task has no eventTarget", async () => {
      const task = buildTestTask("task-without-event", {
        eventTarget: undefined,
      });
      await taskQueue.addTask(task);

      expect(() => {
        taskQueue.updateTask(task.id, { state: TaskState.PROCESSING });
      }).not.toThrow();
    });

    test("throws error when task not found", () => {
      expect(() => {
        taskQueue.updateTask("non-existent-id", {
          state: TaskState.PROCESSING,
        });
      }).toThrow("Task not found: non-existent-id");
    });

    test("can find and update task in any priority queue", async () => {
      const highPriorityTask = buildTestTask("high-task", { priority: 1 });
      const lowPriorityTask = buildTestTask("low-task", { priority: 3 });

      await taskQueue.addTask(highPriorityTask);
      await taskQueue.addTask(lowPriorityTask);

      expect(() => {
        taskQueue.updateTask("high-task", { state: TaskState.PROCESSING });
        taskQueue.updateTask("low-task", { state: TaskState.FAILED });
      }).not.toThrow();

      expect(highPriorityTask.state).toBe(TaskState.PROCESSING);
      expect(lowPriorityTask.state).toBe(TaskState.FAILED);
    });

    test("can update an active task after activation", async () => {
      const task = buildTestTask("active-task");

      await taskQueue.addTask(task);
      await taskQueue.activateWorkableTask();

      expect(() => {
        taskQueue.updateTask(task.id, { state: TaskState.PROCESSING });
      }).not.toThrow();

      expect(task.state).toBe(TaskState.PROCESSING);
    });
  });

  describe("activateWorkableTask", () => {
    test("moves task from waiting queue to active queue and marks it pending", async () => {
      const task = buildTestTask("pending-task");

      await taskQueue.addTask(task);
      const activatedTask = await taskQueue.activateWorkableTask();
      const nextTask = await taskQueue.activateWorkableTask();

      expect(activatedTask?.id).toBe(task.id);
      expect(activatedTask?.state).toBe(TaskState.PENDING);
      expect(nextTask).toBeUndefined();
    });

    test("emits chat-activated when task becomes pending", async () => {
      const eventTarget = new EventEmitter();
      const events = [];
      const task = buildTestTask("pending-event-task", { eventTarget });

      eventTarget.on(ChatEvents.CHAT_ACTIVATED, (payload) => {
        events.push(payload);
      });

      await taskQueue.addTask(task);
      await taskQueue.activateWorkableTask();

      expect(events).toEqual([
        expect.objectContaining({ status: ChatStatus.PENDING }),
      ]);
    });
  });

  describe("multiple tasks operations", () => {
    test("handles multiple tasks correctly", async () => {
      const tasks = [
        createTask({ priority: 1 }),
        createTask({ priority: 2 }),
        createTask({ priority: 1 }),
      ];

      for (const task of tasks) {
        await taskQueue.addTask(task);
      }

      const retrievedTasks = [];
      for (let i = 0; i < tasks.length; i++) {
        const task = await taskQueue.activateWorkableTask();
        if (task) retrievedTasks.push(task);
      }

      expect(retrievedTasks.length).toBe(tasks.length);
    });

    test("can interleave add and get operations", async () => {
      await taskQueue.addTask(buildTestTask("task1", { priority: 2 }));
      const task1 = await taskQueue.activateWorkableTask();
      expect(task1?.id).toBe("task1");

      await taskQueue.addTask(buildTestTask("task2", { priority: 2 }));
      await taskQueue.addTask(buildTestTask("task3", { priority: 1 }));

      const task2 = await taskQueue.activateWorkableTask();
      expect(task2?.id).toBe("task3"); // 优先级1的先出

      const task3 = await taskQueue.activateWorkableTask();
      expect(task3?.id).toBe("task2");

      const task4 = await taskQueue.activateWorkableTask();
      expect(task4).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    test("handles empty queue operations gracefully", async () => {
      const result = await taskQueue.activateWorkableTask();
      expect(result).toBeUndefined();

      expect(() => {
        taskQueue.updateTask("invalid-id", { state: TaskState.PROCESSING });
      }).toThrow();
    });

    test("works with tasks created with buildTaskItem", async () => {
      const customTask = buildTaskItem({
        sessionId: "session-custom",
        chatId: "chat-custom",
        priority: 1,
        payload: [{ type: "text", data: "custom data" }],
      });

      await taskQueue.addTask(customTask);
      const retrieved = await taskQueue.activateWorkableTask();

      expect(retrieved?.id).toEqual(customTask.id);
      expect(retrieved?.source).toBe(TaskSource.EXTERNAL);
      expect(retrieved?.priority).toBe(1);
    });

    test("handles non-sequential priority numbers", async () => {
      await taskQueue.addTask(buildTestTask("p5", { priority: 5 }));
      await taskQueue.addTask(buildTestTask("p10", { priority: 10 }));
      await taskQueue.addTask(buildTestTask("p1", { priority: 1 }));

      const task1 = await taskQueue.activateWorkableTask();
      const task2 = await taskQueue.activateWorkableTask();
      const task3 = await taskQueue.activateWorkableTask();

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
