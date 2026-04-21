/**
 * user-intent/types.ts
 * @description
 * 统一定义 user-intent 子域内部使用的状态类型和输入输出类型。
 *
 * 这个文件只负责类型声明，不放策略解析逻辑，也不放 session 状态读写逻辑。
 * 目的是让“预测结果”“执行策略”“session 内部状态”三者的结构边界保持清楚。
 */
import type { EmptyString, UUID } from "@/types";
import type { IntentControlInput, IntentExecutionPolicy } from "./intent-policy";
import type { PredictedIntent } from "./intent-prediction";

/* ==================== */
/* Session State Types  */
/* ==================== */

export type PredictionIntentSessionContext = {
  predictedIntent: PredictedIntent;
  intentPolicy: IntentExecutionPolicy;
};

/* ==================== */
/* Resolver Input Types */
/* ==================== */

export type ResolvePredictionIntentPolicyInput = Omit<
  IntentControlInput,
  "predictedIntent"
>;

export type UserIntentSessionId = UUID | EmptyString;
