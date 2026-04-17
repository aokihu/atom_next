// @ts-nocheck
import { describe, expect, test } from "bun:test";

import resort from "@/core/queue/resort";
import { TaskSource, TaskState, type TaskItem } from "@/types/task";

type TaskParams = Pick<TaskItem, "id"> &
  Partial<
    Pick<
      TaskItem,
      "chainId" | "parentId" | "priority" | "createdAt" | "updatedAt"
    >
  >;

const buildTask = ({
  id,
  chainId = id,
  parentId,
  priority = 2,
  createdAt = 0,
  updatedAt = 0,
}: TaskParams): TaskItem => ({
  id,
  chainId,
  parentId,
  sessionId: `${id}-session`,
  chatId: `${id}-chat`,
  priority,
  createdAt,
  updatedAt,
  state: TaskState.WAITING,
  eventTarget: undefined,
  source: TaskSource.EXTERNAL,
  channel: { domain: "tui" },
  payload: [{ type: "text", data: id }],
});

describe("queue resort", () => {
  test("sorts by priority ascending", async () => {
    const items = [
      buildTask({ id: "task-3", priority: 3 }),
      buildTask({ id: "task-1", priority: 1 }),
      buildTask({ id: "task-2", priority: 2 }),
    ];

    expect((await resort(items)).map((item) => item.id)).toEqual([
      "task-1",
      "task-2",
      "task-3",
    ]);
  });

  test("keeps parent before child in the same chain", async () => {
    const items = [
      buildTask({
        id: "child",
        chainId: "root",
        parentId: "root",
        priority: 2,
      }),
      buildTask({ id: "other", priority: 2, createdAt: 1 }),
      buildTask({ id: "root", chainId: "root", priority: 2 }),
    ];

    expect((await resort(items)).map((item) => item.id)).toEqual([
      "root",
      "child",
      "other",
    ]);
  });

  test("compacts same-chain tasks ahead of same or lower priority tasks", async () => {
    const items = [
      buildTask({ id: "root", chainId: "root", priority: 2 }),
      buildTask({ id: "other", priority: 2, createdAt: 1 }),
      buildTask({
        id: "child",
        chainId: "root",
        parentId: "root",
        priority: 3,
      }),
    ];

    expect((await resort(items)).map((item) => item.id)).toEqual([
      "root",
      "child",
      "other",
    ]);
  });

  test("does not move a chain ahead of a higher priority task", async () => {
    const items = [
      buildTask({ id: "root", chainId: "root", priority: 2 }),
      buildTask({ id: "urgent", priority: 1 }),
      buildTask({
        id: "child",
        chainId: "root",
        parentId: "root",
        priority: 3,
      }),
    ];

    expect((await resort(items)).map((item) => item.id)).toEqual([
      "urgent",
      "root",
      "child",
    ]);
  });
});
