/**
 * intent-request-runtime/types.ts
 * @description
 * 定义 Runtime 在处理 Intent Request 文本时使用的运行时输入类型。
 *
 * 这个子域负责把：
 * - 原始 intent request 文本
 * - 当前 runtime 上下文
 * - 日志策略
 *
 * 组合成一份可以直接返回给 Runtime 的处理结果。
 */
import type {
  IntentRequestHandleResult,
  IntentRequestSafetyContext,
} from "@/types";

/* ==================== */
/* Runtime Handle Types */
/* ==================== */

export type HandleIntentRequestRuntimeInput = {
  intentRequestText: string;
  safetyContext: IntentRequestSafetyContext | null;
  shouldReportLogs: boolean;
};

export type HandleIntentRequestRuntime = (
  input: HandleIntentRequestRuntimeInput,
) => IntentRequestHandleResult;
