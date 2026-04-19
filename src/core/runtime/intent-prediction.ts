import { isEmpty } from "radashi";

export const RUNTIME_INTENT_TYPES = [
  "direct_answer",
  "memory_lookup",
  "memory_save",
  "follow_up",
  "mixed",
  "unknown",
] as const;

export type RuntimeIntentType = (typeof RUNTIME_INTENT_TYPES)[number];

export type RuntimeIntentContext = {
  sessionId: string;
  type: RuntimeIntentType;
  needsMemory: boolean;
  needsMemorySave: boolean;
  memoryQuery: string;
  confidence: number | null;
  updatedAt: number | null;
};

export const createRuntimeIntentContext = (): RuntimeIntentContext => {
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

const isRuntimeIntentType = (value: string): value is RuntimeIntentType => {
  return RUNTIME_INTENT_TYPES.includes(value as RuntimeIntentType);
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
    type: isRuntimeIntentType(type) ? type : "unknown",
    needsMemory: needsMemory ?? false,
    needsMemorySave: needsMemorySave ?? false,
    memoryQuery: values.MEMORY_QUERY?.trim() ?? "",
    confidence: Number.isFinite(confidence) ? confidence : null,
  };
};
