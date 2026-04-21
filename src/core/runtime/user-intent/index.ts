/**
 * user-intent/index.ts
 * @description
 * user-intent 子域的统一导出入口。
 *
 * 这里只负责转发纯函数和类型，不应该继续向 Runtime 外部暴露内部状态管理对象。
 */
export {
  createPredictedIntent,
  parseIntentPredictionText,
} from "./intent-prediction";
export type { PredictedIntent, PredictedIntentType } from "./intent-prediction";
export {
  createIntentExecutionPolicy,
  resolveIntentPolicy,
} from "./intent-policy";
export type {
  IntentControlInput,
  IntentExecutionPolicy,
  IntentPolicyPredictionTrust,
  IntentPolicyPromptVariant,
} from "./intent-policy";
export type {
  PredictionIntentSessionContext,
  ResolvePredictionIntentPolicyInput,
  UserIntentSessionId,
} from "./types";
