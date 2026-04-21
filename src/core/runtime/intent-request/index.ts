/**
 * intent-request/index.ts
 * @description
 * intent-request 子域的统一导出入口。
 *
 * 这里负责对外暴露：
 * - 文本协议解析
 * - 安全检查
 * - 分发结果标准化
 * - Runtime 层处理组合
 * - Runtime 执行上下文装配
 * - 执行阶段入口
 */
export { parseIntentRequests } from "./parse";
export { checkIntentRequestSafety } from "./safety";
export { dispatchIntentRequests } from "./dispatch";
export { handleIntentRequestRuntime } from "./runtime/handle";
export { createIntentRequestExecutionContext } from "./runtime/execution-context";
export {
  executeIntentRequests,
} from "./execution";
export type {
  IntentRequestExecutionResult,
} from "./types";
