/**
 * user-intent/intent-prediction.ts
 * @description
 * 定义用户输入预测结果的数据结构，以及 prediction 文本协议的解析规则。
 *
 * 这个文件只负责：
 * - predicted intent 的默认值
 * - 预测结果类型定义
 * - LLM 返回文本到预测结果对象的纯解析
 *
 * 它不负责 session 状态保存，也不负责 policy 解析。
 */
import { isEmpty } from "radashi";

/* ==================== */
/* Prediction Types     */
/* ==================== */

export const PREDICTED_INTENT_TYPES = [
  "direct_answer",
  "memory_lookup",
  "memory_save",
  "follow_up",
  "mixed",
  "unknown",
] as const;

export type PredictedIntentType = (typeof PREDICTED_INTENT_TYPES)[number];

export type PredictedIntent = {
  sessionId: string;
  type: PredictedIntentType;
  needsMemory: boolean;
  needsMemorySave: boolean;
  memoryQuery: string;
  confidence: number | null;
  updatedAt: number | null;
};

/* ==================== */
/* Prediction Factory   */
/* ==================== */

export const createPredictedIntent = (): PredictedIntent => {
  return {
    sessionId: "",
    type: "unknown",
    needsMemory: false,
    needsMemorySave: false,
    memoryQuery: "",
    confidence: null,
    updatedAt: null,
  };
};

/* ==================== */
/* Prediction Parsing   */
/* ==================== */

const isPredictedIntentType = (value: string): value is PredictedIntentType => {
  return PREDICTED_INTENT_TYPES.includes(value as PredictedIntentType);
};

const parseIntentBoolean = (value: string) => {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
};

export const parseIntentPredictionText = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !isEmpty(line));

  const values: Record<string, string> = {};

  for (const line of lines) {
    const equalIndex = line.indexOf("=");

    if (equalIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim().toUpperCase();
    const value = line.slice(equalIndex + 1).trim();

    values[key] = value;
  }

  const type = values.TYPE?.toLowerCase() ?? "unknown";
  const needsMemory = parseIntentBoolean(values.NEEDS_MEMORY ?? "false");
  const needsMemorySave = parseIntentBoolean(
    values.NEEDS_MEMORY_SAVE ?? "false",
  );
  const confidence = Number(values.CONFIDENCE);

  return {
    type: isPredictedIntentType(type) ? type : "unknown",
    needsMemory: needsMemory ?? false,
    needsMemorySave: needsMemorySave ?? false,
    memoryQuery: values.MEMORY_QUERY?.trim() ?? "",
    confidence: Number.isFinite(confidence) ? confidence : null,
  };
};
