/**
 * Task 工具模块
 * @description 提供任务相关的公用方法
 */

import { isNullish } from "radashi";
import {
  TaskSource,
  TaskState,
  type TaskChannel,
  type InternalTaskItemInput,
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

type BuildTaskLineageInput = {
  id?: string;
  chainId: string;
  parentId: string | undefined;
  source: TaskSource;
  priority: number;
  chain_round?: number;
};

/**
 * 组装任务对象的公共部分。
 * @description
 * 外部任务和内部任务共享同一套只读冻结逻辑，
 * 差异只保留在 lineage/source/priority 的输入上。
 */
const createTaskItem = (
  params: Pick<TaskItemInput, "sessionId" | "chatId"> &
    Partial<
      Pick<TaskItemInput, "payload" | "eventTarget" | "channel"> &
        Pick<BuildTaskLineageInput, "chain_round">
    > &
    BuildTaskLineageInput,
): TaskItem => {
  const now = Date.now();
  const id = params.id ?? Bun.randomUUIDv7();
  const payload = freezeReadonlyValue<TaskPayload>(
    structuredClone(params.payload ?? []),
  );
  const channel = freezeReadonlyValue<TaskChannel>(
    structuredClone(params.channel ?? { domain: "tui" }),
  );

  const task = {
    id,
    chainId: params.chainId,
    ...(isNullish(params.chain_round)
      ? {}
      : { chain_round: params.chain_round }),
    parentId: params.parentId,
    sessionId: params.sessionId,
    chatId: params.chatId,
    source: params.source,
    state: TaskState.WAITING,
    priority: params.priority,
    payload,
    eventTarget: params.eventTarget ?? null,
    channel,
    createdAt: now,
    updatedAt: now,
  };

  return defineReadonlyTaskItem(task as TaskItem);
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

  const id = Bun.randomUUIDv7();
  return createTaskItem({
    id,
    chainId: id,
    parentId: id,
    sessionId: params.sessionId,
    chatId: params.chatId,
    source: TaskSource.EXTERNAL,
    priority: params.priority ?? 2,
    payload: params.payload,
    eventTarget: params.eventTarget,
    channel: params.channel,
  });
};

/**
 * 构造一个内部任务对象
 * @description
 * 内部任务必须显式传入 chainId 和 parentId，
 * 避免在派生 follow-up 任务时丢失任务链路。
 */
export const buildInternalTaskItem = (
  params: InternalTaskItemInput,
): TaskItem => {
  if (isNullish(params.sessionId)) {
    throw new Error("sessionId is required");
  }
  if (isNullish(params.chatId)) {
    throw new Error("chatId is required");
  }
  if (isNullish(params.chainId)) {
    throw new Error("chainId is required");
  }
  if (isNullish(params.parentId)) {
    throw new Error("parentId is required");
  }

  return createTaskItem({
    chainId: params.chainId,
    parentId: params.parentId,
    chain_round: params.chain_round,
    sessionId: params.sessionId,
    chatId: params.chatId,
    source: TaskSource.INTERNAL,
    priority: params.priority ?? 1,
    payload: params.payload,
    eventTarget: params.eventTarget,
    channel: params.channel,
  });
};
