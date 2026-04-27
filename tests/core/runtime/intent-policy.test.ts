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
      shouldIsolateConversation: false,
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
      topicRelation: "related",
      needsMemory: true,
      memoryQuery: "AGENTS md",
      confidence: 0.96,
      outputBudget: {
        maxOutputTokens: 2000,
        requestTokenReserve: 256,
        visibleOutputBudget: 1744,
      },
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
      shouldIsolateConversation: false,
    });

    expect(policy.acceptedIntentType).toBe("memory_lookup");
    expect(policy.preloadMemory).toBe(true);
    expect(policy.memoryQuery).toBe("AGENTS md");
    expect(policy.promptVariant).toBe("recall");
    expect(policy.maxFollowUpRounds).toBe(2);
    expect(policy.predictionTrust).toBe("high");
    expect(policy.maxOutputTokens).toBe(2000);
    expect(policy.requestTokenReserve).toBe(256);
    expect(policy.visibleOutputBudget).toBe(1744);
    expect(policy.preferEarlyFollowUp).toBe(true);
    expect(policy.isNewChatInSession).toBe(true);
    expect(policy.responseStrategyText).toContain("MAX_OUTPUT_TOKENS=2000");
    expect(policy.responseStrategyText).toContain("REQUEST_TOKEN_RESERVE=256");
    expect(policy.responseStrategyText).toContain("这是同一 session 下的新 chat");
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
      shouldIsolateConversation: false,
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
      shouldIsolateConversation: false,
    });

    expect(policy.acceptedIntentType).toBe("memory_save");
    expect(policy.allowMemorySave).toBe(false);
    expect(policy.predictionTrust).toBe("medium");
    expect(policy.promptVariant).toBe("continuity");
  });

  test("isolates conversation for unrelated topic even when session has history", () => {
    const predictedIntent = {
      ...createPredictedIntent(),
      sessionId: "session-1",
      type: "direct_answer",
      topicRelation: "unrelated",
      confidence: 0.88,
      outputBudget: {
        maxOutputTokens: 2000,
        requestTokenReserve: 256,
        visibleOutputBudget: 1744,
      },
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
      shouldIsolateConversation: true,
    });

    expect(policy.isNewChatInSession).toBe(true);
    expect(policy.topicRelation).toBe("unrelated");
    expect(policy.shouldIsolateConversation).toBe(true);
    expect(policy.promptVariant).toBe("default");
    expect(policy.responseStrategyText).toContain(
      "当前 chat 被判定为新话题，旧 session conversation 已隔离",
    );
  });
});
