/**
 * Task 工具模块
 * @description 提供任务相关的公用方法
 */

import { isNullish } from "radashi";
import type { BuildTaskItemInput, TaskItem } from "@/types/queue";

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
 * @description 这里只接收创建外部任务所需的最小输入
 * @returns 返回构造好的任务对象
 */
export const buildTaskItem = (params: BuildTaskItemInput): TaskItem => {
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
    chainId: id,
    parentId: id,
    sessionId: params.sessionId,
    chatId: params.chatId,
    source: "external" as const,
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
