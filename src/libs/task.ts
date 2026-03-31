/**
 * Task 工具模块
 * @description 提供任务相关的公用方法
 */

import { isNullish } from "radashi";
import {
  TaskSource,
  TaskState,
  type TaskChannel,
  type TaskItemInput,
  type TaskItem,
  type TaskPayload,
} from "@/types/task";

type SettableTaskItemKeys = "updatedAt" | "state";
const SETTABLE_KEYS = new Set<SettableTaskItemKeys>(["updatedAt", "state"]);

const freezeReadonlyValue = <T>(value: T): T => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => freezeReadonlyValue(item));
    return Object.freeze(value);
  }

  Object.values(value).forEach((item) => freezeReadonlyValue(item));
  return Object.freeze(value);
};

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
export const buildTaskItem = (params: TaskItemInput): TaskItem => {
  if (isNullish(params.sessionId)) {
    throw new Error("sessionId is required");
  }
  if (isNullish(params.chatId)) {
    throw new Error("chatId is required");
  }

  const now = Date.now();
  const id = Bun.randomUUIDv7();
  const payload = freezeReadonlyValue<TaskPayload>(
    structuredClone(params.payload ?? []),
  );
  const channel = freezeReadonlyValue<TaskChannel>(
    structuredClone(params.channel ?? { domain: "tui" }),
  );

  const task = {
    id,
    chainId: id,
    parentId: id,
    sessionId: params.sessionId,
    chatId: params.chatId,
    source: TaskSource.EXTERNAL,
    state: TaskState.WAITING,
    priority: params.priority ?? 2,
    payload,
    eventTarget: params.eventTarget ?? null,
    channel,
    createdAt: now,
    updatedAt: now,
  };

  return defineReadonlyTaskItem(task as TaskItem);
};
