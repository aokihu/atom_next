/**
 * Task 工具模块
 * @description 提供任务相关的公用方法
 */

import { isNullish } from "radashi";
import type { TaskItem, RawTaskItem } from "@/types/queue";

type SettableTaskItemKeys = "updatedAt" | "state";
const SETTABLE_KEYS = new Set<SettableTaskItemKeys>(["updatedAt", "state"]);

const defineReadonlyTaskItem = (task: TaskItem): TaskItem => {
  for (const key of Object.keys(task) as Array<keyof TaskItem>) {
    Object.defineProperty(task, key, {
      value: task[key],
      enumerable: true,
      configurable: false,
      writable: SETTABLE_KEYS.has(key as SettableTaskItemKeys),
    });
  }

  return task;
};

/**
 * 构造一个任务对象
 * @returns 返回构造好的任务对象
 */
export const buildTaskItem = (
  params: Partial<Omit<RawTaskItem, "id">>,
): TaskItem => {
  if (isNullish(params.sessionId)) {
    throw new Error("sessionId is required");
  }
  if (isNullish(params.chatId)) {
    throw new Error("chatId is required");
  }

  const now = Date.now();
  const id = Bun.randomUUIDv7();

  const task = {
    id,
    chainId: params.chainId ?? id,
    parentId: params.parentId ?? id,
    sessionId: params.sessionId ?? "",
    chatId: params.chatId ?? "",
    source: params.source ?? "external",
    state: "",
    priority: params.priority ?? 2,
    payload: params.payload ?? [],
    eventTarget: params.eventTarget ?? null,
    channel: params.channel ?? { domain: "tui" },
    createdAt: now,
    updatedAt: now,
  };

  return defineReadonlyTaskItem(task as TaskItem);
};
