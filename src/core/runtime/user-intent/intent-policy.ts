/**
 * user-intent/intent-policy.ts
 * @description
 * 定义 user-intent 子域中的策略模型与策略解析规则。
 *
 * 这个文件负责把“预测结果 + 当前运行时条件”解析成一个稳定的执行策略，
 * 比如是否预加载 memory、允许多少 follow-up、采用哪种 prompt variant。
 *
 * 它不持有 session 状态，只负责纯计算。
 */
import type { MemoryScope, TaskSource } from "@/types";
import type { PredictedIntent, PredictedIntentType } from "./intent-prediction";

/* ==================== */
/* Policy Constants     */
/* ==================== */

export const INTENT_POLICY_PROMPT_VARIANTS = [
  "default",
  "recall",
  "continuity",
  "strict",
] as const;

export const INTENT_POLICY_PREDICTION_TRUST = [
  "high",
  "medium",
  "low",
] as const;

export type IntentPolicyPromptVariant =
  (typeof INTENT_POLICY_PROMPT_VARIANTS)[number];
export type IntentPolicyPredictionTrust =
  (typeof INTENT_POLICY_PREDICTION_TRUST)[number];

/* ==================== */
/* Policy Types         */
/* ==================== */

export type IntentExecutionPolicy = {
  sessionId: string;
  acceptedIntentType: PredictedIntentType;
  preloadMemory: boolean;
  memoryQuery: string;
  allowMemorySave: boolean;
  maxFollowUpRounds: number;
  promptVariant: IntentPolicyPromptVariant;
  predictionTrust: IntentPolicyPredictionTrust;
  maxOutputTokens: number | null;
  requestTokenReserve: number | null;
  visibleOutputBudget: number | null;
  preferEarlyFollowUp: boolean;
  isNewChatInSession: boolean;
  responseStrategyText: string;
  reasons: string[];
  updatedAt: number | null;
};

type IntentMemoryState = {
  [scope in MemoryScope]: "idle" | "loaded" | "empty";
};

export type IntentControlInput = {
  predictedIntent: PredictedIntent;
  taskSource: TaskSource;
  chainRound: number | null;
  currentMemoryState: IntentMemoryState;
  sessionHistoryAvailable: boolean;
};

/* ==================== */
/* Policy Rules         */
/* ==================== */

export const createIntentExecutionPolicy = (): IntentExecutionPolicy => {
  return {
    sessionId: "",
    acceptedIntentType: "unknown",
    preloadMemory: false,
    memoryQuery: "",
    allowMemorySave: false,
    maxFollowUpRounds: 1,
    promptVariant: "default",
    predictionTrust: "low",
    maxOutputTokens: null,
    requestTokenReserve: null,
    visibleOutputBudget: null,
    preferEarlyFollowUp: false,
    isNewChatInSession: false,
    responseStrategyText: "",
    reasons: [],
    updatedAt: null,
  };
};

const createResponseStrategyText = (input: {
  maxOutputTokens: number;
  requestTokenReserve: number;
  visibleOutputBudget: number;
  isNewChatInSession: boolean;
}) => {
  const lines = [
    "当前轮输出预算：",
    `- MAX_OUTPUT_TOKENS=${input.maxOutputTokens}`,
    `- REQUEST_TOKEN_RESERVE=${input.requestTokenReserve}`,
    `- VISIBLE_OUTPUT_BUDGET=${input.visibleOutputBudget}`,
    "",
  ];

  if (input.isNewChatInSession) {
    lines.push(
      "会话规则：",
      "- 这是同一 session 下的新 chat，不是上一个 chat 的自然尾声",
      "- <Conversation> 只用于参考历史，不代表当前问题已经接近完成",
      "- 是否发起 FOLLOW_UP，必须只根据当前 chat 的任务规模和当前轮预算判断",
      "",
    );
  }

  lines.push(
    "回答建议：",
    `- 正文内容应优先控制在约 ${input.visibleOutputBudget} token 内，不要尝试一次覆盖全部剩余内容`,
    `- 必须始终为 Intent Request 预留至少 ${input.requestTokenReserve} token`,
    "- 当你判断剩余内容无法在当前预算内完成时，应在一个自然段落后立即输出合法的 FOLLOW_UP",
    "- 如果后续进入 follow-up 链路，应比首轮更早收束正文",
    "- 不允许用“下一部分将继续”之类的可见文本代替 FOLLOW_UP",
  );

  return lines.join("\n");
};

export const resolveIntentPolicy = (input: IntentControlInput) => {
  const policy = createIntentExecutionPolicy();
  const { predictedIntent } = input;
  const outputBudget = predictedIntent.outputBudget;

  policy.maxOutputTokens = outputBudget.maxOutputTokens;
  policy.requestTokenReserve = outputBudget.requestTokenReserve;
  policy.visibleOutputBudget = outputBudget.visibleOutputBudget;
  policy.preferEarlyFollowUp = outputBudget.visibleOutputBudget !== null;
  policy.isNewChatInSession =
    input.taskSource === "external" && input.sessionHistoryAvailable;

  if (
    outputBudget.maxOutputTokens !== null &&
    outputBudget.requestTokenReserve !== null &&
    outputBudget.visibleOutputBudget !== null
  ) {
    policy.responseStrategyText = createResponseStrategyText({
      maxOutputTokens: outputBudget.maxOutputTokens,
      requestTokenReserve: outputBudget.requestTokenReserve,
      visibleOutputBudget: outputBudget.visibleOutputBudget,
      isNewChatInSession: policy.isNewChatInSession,
    });
  }

  if (input.taskSource === "internal") {
    policy.reasons.push(
      "Internal task reuses the previously resolved policy without drift.",
    );
    return policy;
  }

  if (predictedIntent.confidence === null) {
    policy.reasons.push(
      "Prediction confidence is unavailable, so the resolver fell back to the default policy.",
    );
    return policy;
  }

  if (predictedIntent.confidence < 0.5) {
    policy.reasons.push(
      "Prediction confidence is below 0.5, so it cannot drive the main flow.",
    );
    return policy;
  }

  policy.acceptedIntentType = predictedIntent.type;
  policy.memoryQuery = predictedIntent.memoryQuery;
  policy.predictionTrust =
    predictedIntent.confidence >= 0.8 ? "high" : "medium";
  policy.promptVariant = input.sessionHistoryAvailable
    ? "continuity"
    : "default";

  policy.reasons.push(
    `Accepted predicted intent "${predictedIntent.type}" with ${policy.predictionTrust} trust.`,
  );

  if (predictedIntent.needsMemorySave) {
    if (predictedIntent.confidence >= 0.85) {
      policy.allowMemorySave = true;
      policy.reasons.push(
        "Memory save is allowed because confidence is at least 0.85.",
      );
    } else {
      policy.reasons.push(
        "Memory save is blocked because confidence is below 0.85.",
      );
    }
  }

  if (predictedIntent.type !== "memory_lookup") {
    return policy;
  }

  policy.promptVariant = "recall";
  policy.maxFollowUpRounds = input.sessionHistoryAvailable ? 2 : 1;
  policy.reasons.push(
    "Memory recall intent promotes the prompt variant to recall.",
  );

  if (predictedIntent.confidence < 0.8 || predictedIntent.memoryQuery === "") {
    if (predictedIntent.confidence < 0.8) {
      policy.reasons.push(
        "Memory preload is skipped because recall confidence is below 0.8.",
      );
    }

    if (predictedIntent.memoryQuery === "") {
      policy.reasons.push(
        "Memory preload is skipped because the predicted memory query is empty.",
      );
    }

    return policy;
  }

  if (input.currentMemoryState.long === "loaded") {
    policy.reasons.push(
      "Memory preload is skipped because long memory is already loaded.",
    );
    return policy;
  }

  policy.preloadMemory = true;
  policy.reasons.push(
    "Memory preload is enabled because high-confidence recall needs long memory.",
  );

  return policy;
};
