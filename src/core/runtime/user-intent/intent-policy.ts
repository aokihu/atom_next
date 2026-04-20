import type { MemoryScope, TaskSource } from "@/types";
import type { PredictedIntent, PredictedIntentType } from "./intent-prediction";

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

export type IntentExecutionPolicy = {
  sessionId: string;
  acceptedIntentType: PredictedIntentType;
  preloadMemory: boolean;
  memoryQuery: string;
  allowMemorySave: boolean;
  maxFollowUpRounds: number;
  promptVariant: IntentPolicyPromptVariant;
  predictionTrust: IntentPolicyPredictionTrust;
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
    reasons: [],
    updatedAt: null,
  };
};

export const resolveIntentPolicy = (input: IntentControlInput) => {
  const policy = createIntentExecutionPolicy();
  const { predictedIntent } = input;

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
