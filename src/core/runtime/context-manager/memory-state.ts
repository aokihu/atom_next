/**
 * context-manager/memory-state.ts
 * @description
 * 收口 ContextManager 使用的 memory 状态构造规则。
 *
 * 这个文件只负责根据输入构建 memory scope context，
 * 不直接读写 session state，也不决定何时加载或清空 memory。
 * 这样 memory 状态长相和状态切换规则可以独立演进，
 * 不必继续堆进 ContextManager 主文件。
 */
import type { MemoryScope } from "@/types";
import type { RuntimeMemoryItem } from "../memory-item";
import type { RuntimeMemoryScopeContext } from "./types";

/* ==================== */
/* Memory State Factory */
/* ==================== */

export const createLoadedMemoryScopeContext = (
  outputs: RuntimeMemoryItem[],
  options: {
    query?: string;
    reason?: string;
  } = {},
): RuntimeMemoryScopeContext => {
  return {
    status: "loaded",
    query: options.query?.trim() ?? "",
    reason: options.reason?.trim() ?? "",
    outputs: structuredClone(outputs),
    updatedAt: Date.now(),
  };
};

export const createEmptyMemoryScopeContext = (options: {
  query: string;
  reason: string;
}): RuntimeMemoryScopeContext => {
  return {
    status: "empty",
    query: options.query.trim(),
    reason: options.reason.trim(),
    outputs: [],
    updatedAt: Date.now(),
  };
};

/* ==================== */
/* Search Result State  */
/* ==================== */

export const createMemorySearchResultContext = (
  scope: MemoryScope,
  options: {
    words: string;
    outputs: RuntimeMemoryItem[];
    reason?: string;
  },
): RuntimeMemoryScopeContext => {
  if (options.outputs.length > 0) {
    return createLoadedMemoryScopeContext(options.outputs, {
      query: options.words,
      reason: options.reason,
    });
  }

  return createEmptyMemoryScopeContext({
    query: options.words,
    reason:
      options.reason?.trim() ||
      `No ${scope} memory matched ${options.words.trim()}`,
  });
};
