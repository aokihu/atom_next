// @ts-nocheck
import { describe, expect, test } from "bun:test";

import {
  createPredictedIntent,
  resolveIntentPolicy,
} from "@/core/runtime";

describe("Intent policy resolver", () => {
  test("falls back to default policy when confidence is low", () => {
    const predictedIntent = {
      ...createPredictedIntent(),
      sessionId: "session-1",
      type: "memory_lookup",
      needsMemory: true,
      memoryQuery: "AGENTS md",
      confidence: 0.42,
    };

    const policy = resolveIntentPolicy({
      predictedIntent,
      taskSource: "external",
      chainRound: null,
      currentMemoryState: {
        core: "idle",
        short: "idle",
        long: "idle",
      },
      sessionHistoryAvailable: false,
    });

    expect(policy.acceptedIntentType).toBe("unknown");
    expect(policy.preloadMemory).toBe(false);
    expect(policy.allowMemorySave).toBe(false);
    expect(policy.promptVariant).toBe("default");
    expect(policy.predictionTrust).toBe("low");
  });

  test("enables preload for high-confidence memory recall", () => {
    const predictedIntent = {
      ...createPredictedIntent(),
      sessionId: "session-1",
      type: "memory_lookup",
      needsMemory: true,
      memoryQuery: "AGENTS md",
      confidence: 0.96,
    };

    const policy = resolveIntentPolicy({
      predictedIntent,
      taskSource: "external",
      chainRound: null,
      currentMemoryState: {
        core: "idle",
        short: "idle",
        long: "idle",
      },
      sessionHistoryAvailable: true,
    });

    expect(policy.acceptedIntentType).toBe("memory_lookup");
    expect(policy.preloadMemory).toBe(true);
    expect(policy.memoryQuery).toBe("AGENTS md");
    expect(policy.promptVariant).toBe("recall");
    expect(policy.maxFollowUpRounds).toBe(2);
    expect(policy.predictionTrust).toBe("high");
  });

  test("blocks repeated preload when long memory is already loaded", () => {
    const predictedIntent = {
      ...createPredictedIntent(),
      sessionId: "session-1",
      type: "memory_lookup",
      needsMemory: true,
      memoryQuery: "watchman",
      confidence: 0.9,
    };

    const policy = resolveIntentPolicy({
      predictedIntent,
      taskSource: "external",
      chainRound: null,
      currentMemoryState: {
        core: "idle",
        short: "idle",
        long: "loaded",
      },
      sessionHistoryAvailable: false,
    });

    expect(policy.acceptedIntentType).toBe("memory_lookup");
    expect(policy.preloadMemory).toBe(false);
    expect(policy.promptVariant).toBe("recall");
  });

  test("keeps memory save disabled below the save threshold", () => {
    const predictedIntent = {
      ...createPredictedIntent(),
      sessionId: "session-1",
      type: "memory_save",
      needsMemory: false,
      needsMemorySave: true,
      memoryQuery: "",
      confidence: 0.7,
    };

    const policy = resolveIntentPolicy({
      predictedIntent,
      taskSource: "external",
      chainRound: null,
      currentMemoryState: {
        core: "idle",
        short: "idle",
        long: "idle",
      },
      sessionHistoryAvailable: true,
    });

    expect(policy.acceptedIntentType).toBe("memory_save");
    expect(policy.allowMemorySave).toBe(false);
    expect(policy.predictionTrust).toBe("medium");
    expect(policy.promptVariant).toBe("continuity");
  });
});
