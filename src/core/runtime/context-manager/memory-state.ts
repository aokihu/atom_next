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
import type { MemoryScope, RuntimeMemoryOutput } from "@/types";
import type { RuntimeMemoryScopeContext } from "./types";

/* ==================== */
/* Memory State Factory */
/* ==================== */

export const createLoadedMemoryScopeContext = (
  output: RuntimeMemoryOutput,
  options: {
    query?: string;
    reason?: string;
  } = {},
): RuntimeMemoryScopeContext => {
  return {
    status: "loaded",
    query: options.query?.trim() ?? "",
    reason: options.reason?.trim() ?? "",
    output: structuredClone(output),
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
    output: null,
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
    output: RuntimeMemoryOutput | null;
    reason?: string;
  },
): RuntimeMemoryScopeContext => {
  if (options.output) {
    return createLoadedMemoryScopeContext(options.output, {
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
