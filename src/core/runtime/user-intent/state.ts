/**
 * user-intent/state.ts
 * @description
 * 提供 user-intent 子域的基础状态工厂。
 *
 * 这个文件只负责创建 session 级默认状态，
 * 不参与预测解析、策略计算或 session 状态持有。
 */
import { createIntentExecutionPolicy } from "./intent-policy";
import { createPredictedIntent } from "./intent-prediction";
import type { PredictionIntentSessionContext } from "./types";

/* ==================== */
/* State Factory        */
/* ==================== */

export const createPredictionIntentSessionContext =
  (): PredictionIntentSessionContext => {
    return {
      predictedIntent: createPredictedIntent(),
      intentPolicy: createIntentExecutionPolicy(),
    };
  };
