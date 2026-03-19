/**
 * 对任务队列重新排列
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0
 */

import type { TaskItem, TaskItems } from "@/types/queue";

type SortableTask = TaskItem & { index: number };

const compareTask = (a: SortableTask, b: SortableTask): number => {
  return (
    a.priority - b.priority ||
    a.createdAt - b.createdAt ||
    a.updatedAt - b.updatedAt ||
    a.index - b.index
  );
};

const buildChainItems = (items: SortableTask[]): SortableTask[] => {
  if (items.length < 2) return items;

  const itemIds = new Set(items.map((item) => item.id));
  const childrenMap = new Map<string, SortableTask[]>();
  const roots: SortableTask[] = [];

  for (const item of items) {
    const parentId = item.parentId;
    const hasParentInChain =
      parentId !== undefined && parentId !== item.id && itemIds.has(parentId);

    if (!hasParentInChain) {
      roots.push(item);
      continue;
    }

    const children = childrenMap.get(parentId) ?? [];
    children.push(item);
    childrenMap.set(parentId, children);
  }

  const ordered: SortableTask[] = [];
  const visited = new Set<string>();

  const visit = (item: SortableTask) => {
    if (visited.has(item.id)) return;

    visited.add(item.id);
    ordered.push(item);

    for (const child of childrenMap.get(item.id) ?? []) {
      visit(child);
    }
  };

  for (const root of roots) visit(root);

  // 兜底处理异常链路数据,避免循环引用或孤儿节点被丢弃。
  for (const item of items) visit(item);

  return ordered;
};

/**
 * 从新对任务队列排序
 * @param items
 * @returns 返回重新排序后的任务队列数组
 * @description 排序按照以下优先级进行:
 *              1. priority 越小排序越靠前
 *              2. chainId相同的请款,按照parentId进行排序,子任务排在父任务之后
 *              3. 如果相同chainId任务中间有优先级相同或者更低的任务,那么自动提升chainId相同的后续任务
 *
 *              比如按照优先级(左边为数组开始)
 *              {priority: 1},{priority: 2},{priority: 2},{priority: 3}
 *
 *              按照chainID(左边为数组开始)
 *              {id: ID1, chainId: ID1, priority: 2},{id: ID2, chainId: ID1, priority: 2},{id: ID3, chainId: ID3, priority: 2}
 *
 *              链式任务中间有其他任务(左边为数组开始)
 *              {id: ID1, chainId: ID1, priority: 2},{id: ID2, chainId: ID2, priority: 2},{id: ID3, chainId: ID1, priority: 2}
 *              排序为
 *              {id: ID1, chainId: ID1, priority: 2},{id: ID3, chainId: ID1, priority: 2},{id: ID2, chainId: ID2, priority: 2}
 */
// 辅助函数：让出事件循环
const yieldToEventLoop = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

const resort: (items: TaskItems) => Promise<TaskItems> = async (items) => {
  // 第一步：映射和排序
  const sortedItems = items
    .map<SortableTask>((item, index) => ({ ...item, index }))
    .sort(compareTask);

  // 第二步：构建 chainMap，在大数据时让出事件循环
  const chainMap = new Map<string, SortableTask[]>();
  let i = 0;
  for (const item of sortedItems) {
    const chainItems = chainMap.get(item.chainId) ?? [];
    chainItems.push(item);
    chainMap.set(item.chainId, chainItems);

    // 每处理1000个项目让出一次事件循环
    i++;
    if (i % 1000 === 0) {
      await yieldToEventLoop();
    }
  }

  // 第三步：构建结果
  const result: TaskItems = [];
  const emittedChains = new Set<string>();

  i = 0;
  for (const item of sortedItems) {
    if (emittedChains.has(item.chainId)) continue;

    const chainItems = buildChainItems(chainMap.get(item.chainId) ?? [item]);
    emittedChains.add(item.chainId);

    for (const chainItem of chainItems) {
      const { index: _index, ...task } = chainItem;
      result.push(task);
    }

    // 每处理100个chain让出一次事件循环
    i++;
    if (i % 100 === 0) {
      await yieldToEventLoop();
    }
  }

  return result;
};

export default resort;
