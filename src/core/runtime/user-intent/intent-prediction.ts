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
import { z } from "zod";

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

export const PREDICTED_TOPIC_RELATIONS = [
  "related",
  "unrelated",
  "uncertain",
] as const;

export type PredictedTopicRelation =
  (typeof PREDICTED_TOPIC_RELATIONS)[number];

export type PredictedIntentOutputBudget = {
  maxOutputTokens: number | null;
  requestTokenReserve: number | null;
  visibleOutputBudget: number | null;
};

export type PredictedIntent = {
  sessionId: string;
  type: PredictedIntentType;
  topicRelation: PredictedTopicRelation;
  needsMemory: boolean;
  needsMemorySave: boolean;
  memoryQuery: string;
  confidence: number | null;
  estimatedOutputScale: "short" | "long" | null;
  outputBudget: PredictedIntentOutputBudget;
  updatedAt: number | null;
};

export const IntentPredictionSchema = z.object({
  type: z.enum(PREDICTED_INTENT_TYPES).optional(),
  topicRelation: z.enum(PREDICTED_TOPIC_RELATIONS).optional(),
  needsMemory: z.boolean().optional(),
  needsMemorySave: z.boolean().optional(),
  memoryQuery: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  estimatedOutputScale: z.enum(["short", "long"]).optional(),
}).passthrough();

/* ==================== */
/* Prediction Factory   */
/* ==================== */

export const createPredictedIntent = (): PredictedIntent => {
  return {
    sessionId: "",
    type: "unknown",
    topicRelation: "uncertain",
    needsMemory: false,
    needsMemorySave: false,
    memoryQuery: "",
    confidence: null,
    estimatedOutputScale: null,
    outputBudget: {
      maxOutputTokens: null,
      requestTokenReserve: null,
      visibleOutputBudget: null,
    },
    updatedAt: null,
  };
};

/* ==================== */
/* Prediction Parsing   */
/* ==================== */

export const parseIntentPredictionText = (text: string) => {
  if (isEmpty(text.trim())) {
    return {
      type: "unknown" as PredictedIntentType,
      topicRelation: "uncertain" as PredictedTopicRelation,
      needsMemory: false,
      needsMemorySave: false,
      memoryQuery: "",
      confidence: null,
      estimatedOutputScale: null,
    };
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(text);
  } catch {
    return {
      type: "unknown" as PredictedIntentType,
      topicRelation: "uncertain" as PredictedTopicRelation,
      needsMemory: false,
      needsMemorySave: false,
      memoryQuery: "",
      confidence: null,
      estimatedOutputScale: null,
    };
  }

  const parsed = IntentPredictionSchema.safeParse(parsedJson);

  if (!parsed.success) {
    return {
      type: "unknown" as PredictedIntentType,
      topicRelation: "uncertain" as PredictedTopicRelation,
      needsMemory: false,
      needsMemorySave: false,
      memoryQuery: "",
      confidence: null,
      estimatedOutputScale: null,
    };
  }

  return {
    type: parsed.data.type ?? "unknown",
    topicRelation: parsed.data.topicRelation ?? "uncertain",
    needsMemory: parsed.data.needsMemory ?? false,
    needsMemorySave: parsed.data.needsMemorySave ?? false,
    memoryQuery: parsed.data.memoryQuery?.trim() ?? "",
    confidence: parsed.data.confidence ?? null,
    estimatedOutputScale: parsed.data.estimatedOutputScale ?? null,
  };
};
