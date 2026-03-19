import type { TaskItem, RawTaskItem } from "@/types/queue";

type SettableTaskItemKeys = "updatedAt" | "state";
const SETTABLE_KEYS = new Set<SettableTaskItemKeys>(["updatedAt", "state"]);

/**
 * 构造一个任务对象
 * @returns 返回构造好的任务对象
 */
export const buildTaskItem = (
  params: Partial<Omit<RawTaskItem, "id">>,
): TaskItem => {
  const now = Date.now();
  const id = Bun.randomUUIDv7();

  const task = {
    id,
    chainId: params.chainId ?? id,
    parentId: params.parentId ?? id,
    source: params.source ?? "external",
    state: "",
    priority: params.priority ?? 2,
    payload: params.payload ?? [],
    channel: params.channel ?? { domain: "tui" },
    createdAt: now,
    updatedAt: now,
  };

  const proxy = new Proxy(task, {
    set(target, property, value) {
      const prop = property as keyof TaskItem;
      if (SETTABLE_KEYS.has(prop as SettableTaskItemKeys)) {
        (target as any)[prop] = value;
        return true;
      }
      throw new Error(
        `Cannot modify property '${String(property)}': only ${Array.from(SETTABLE_KEYS).join(" and ")} can be modified`,
      );
    },
  });

  return proxy as TaskItem;
};
