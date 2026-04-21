/**
 * intent-request/index.ts
 * @description
 * intent-request 子域的统一导出入口。
 *
 * 这里负责对外暴露：
 * - 文本协议解析
 * - 安全检查
 * - 分发结果标准化
 * - 执行阶段入口
 */
export { parseIntentRequests } from "./parse";
export { checkIntentRequestSafety } from "./safety";
export { dispatchIntentRequests } from "./dispatch";
export {
  executeIntentRequests,
} from "./execution";
export type {
  IntentRequestExecutionResult,
} from "./types";
