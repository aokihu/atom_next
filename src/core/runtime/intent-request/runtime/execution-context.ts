/**
 * intent-request/runtime/execution-context.ts
 * @description
 * 负责为 Intent Request 执行阶段构造 Runtime 侧执行上下文。
 *
 * 这个文件只处理依赖装配：
 * - memory service
 * - memory context 读写
 * - intent policy 写入
 *
 * 它不负责执行请求列表，也不负责协议解析。
 */
import type { ServiceManager } from "@/libs/service-manage";
import type { ContextManager } from "../../context-manager";
import { resolveMemoryService } from "../../service-access";
import type { RuntimeIntentRequestExecutionContext } from "../types";
import type { IntentExecutionPolicy } from "../../user-intent";

/* ==================== */
/* Execution Context    */
/* ==================== */

export type CreateIntentRequestExecutionContextInput = {
  serviceManager: ServiceManager;
  contextManager: ContextManager;
  setIntentPolicy: (
    sessionId: string,
    policy: Omit<IntentExecutionPolicy, "updatedAt">,
  ) => void;
};

/**
 * 创建 Intent Request 执行阶段所需的 Runtime 上下文。
 * @description
 * Runtime 作为唯一对外入口，仍然负责提供执行上下文；
 * 但具体依赖装配细节收口到这里，避免 runtime.ts 继续堆积样板代码。
 */
export function createIntentRequestExecutionContext(
  input: CreateIntentRequestExecutionContextInput,
): RuntimeIntentRequestExecutionContext {
  return {
    memory: resolveMemoryService(input.serviceManager),
    getMemoryContext: (scope) => {
      const memoryContext = input.contextManager.getMemoryContext(scope);
      return {
        status: memoryContext.status,
        query: memoryContext.query,
      };
    },
    recordMemorySearchResult: (scope, options) => {
      input.contextManager.recordMemorySearchResult(scope, options);
    },
    setMemoryContext: (scope, output, options) => {
      input.contextManager.setMemoryContext(scope, output, options);
    },
    getLoadedMemoryScopeByKey: (memoryKey) => {
      return input.contextManager.getLoadedMemoryScopeByKey(memoryKey);
    },
    unloadMemoryContextByKey: (memoryKey) => {
      return input.contextManager.unloadMemoryContextByKey(memoryKey);
    },
    setIntentPolicy: (sessionId, policy) => {
      input.setIntentPolicy(sessionId, policy);
    },
  };
}
