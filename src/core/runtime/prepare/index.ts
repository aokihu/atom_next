/**
 * prepare/index.ts
 * @description
 * 负责 Runtime 在正式对话前的预处理链路。
 *
 * 这个模块处理 external task 的 prepare 流程：
 * - 调用 prediction prompt
 * - 解析 prediction 文本
 * - 写入预测结果或 fallback 结果
 * - 根据当前上下文解析 intent policy
 * - 构造 PREPARE_CONVERSATION 请求
 *
 * Runtime 仍然是对外唯一入口；
 * 这里仅承接内部流程编排，避免 runtime.ts 继续堆积实现细节。
 */
import {
  IntentRequestSource,
  IntentRequestType,
} from "@/types";
import type {
  PrepareConversationIntentRequest,
} from "@/types";
import { TaskSource, type TaskFollowUpPolicy } from "@/types/task";
import type { IntentExecutionPolicy } from "../user-intent";
import {
  createPredictedIntent,
  IntentPredictionSchema,
} from "../user-intent";
import type { PrepareExecutionContext } from "./types";

/* ==================== */
/* Request Builder      */
/* ==================== */

const resolveLongOutputFollowUpPolicy = (params: {
  estimatedOutputScale: string | null;
  chainRound?: number;
}): TaskFollowUpPolicy | undefined => {
  if (params.estimatedOutputScale === "long") {
    return {
      mode: "maybe",
      reason: "long_output",
    };
  }

  if ((params.chainRound ?? 0) >= 1) {
    return {
      mode: "maybe",
      reason: "long_output",
    };
  }

  return undefined;
};

/**
 * 根据已解析的 intent policy 构造 PREPARE_CONVERSATION 请求。
 * @description
 * prepare 子域只负责把预处理结果转成统一请求对象，
 * 真正的请求执行仍由 intent-request/execution 子域负责。
 */
export function createPrepareConversationIntentRequest(
  policy: IntentExecutionPolicy,
  followUpPolicy?: TaskFollowUpPolicy,
): PrepareConversationIntentRequest {
  return {
    source: IntentRequestSource.PREDICTION,
    request: IntentRequestType.PREPARE_CONVERSATION,
    intent: "根据当前用户输入预测结果准备正式对话。",
    params: {
      acceptedIntentType: policy.acceptedIntentType,
      preloadMemory: policy.preloadMemory,
      memoryQuery: policy.memoryQuery,
      allowMemorySave: policy.allowMemorySave,
      maxFollowUpRounds: policy.maxFollowUpRounds,
      promptVariant: policy.promptVariant,
      predictionTrust: policy.predictionTrust,
      maxOutputTokens: policy.maxOutputTokens,
      requestTokenReserve: policy.requestTokenReserve,
      visibleOutputBudget: policy.visibleOutputBudget,
      preferEarlyFollowUp: policy.preferEarlyFollowUp,
      isNewChatInSession: policy.isNewChatInSession,
      topicRelation: policy.topicRelation,
      shouldIsolateConversation: policy.shouldIsolateConversation,
      responseStrategyText: policy.responseStrategyText,
      followUpPolicy,
    },
  };
}

/* ==================== */
/* Prepare Flow         */
/* ==================== */

/**
 * 准备当前 external task 的执行上下文。
 * @description
 * internal task 直接跳过，避免 FOLLOW_UP 续跑时发生策略漂移。
 */
export const prepareExecutionContext: PrepareExecutionContext = async (
  task,
  deps,
) => {
  if (task.source !== TaskSource.EXTERNAL) {
    return null;
  }

  deps.applyTopicArchiveTurnLifecycle();

  const sessionHistoryAvailable = deps.hasSessionHistory();
  const outputBudget = deps.getFormalConversationOutputBudget();
  const fallbackIntent = createPredictedIntent();
  let predictedIntentInput = {
    sessionId: task.sessionId,
    type: fallbackIntent.type,
    topicRelation: fallbackIntent.topicRelation,
    needsMemory: fallbackIntent.needsMemory,
    needsMemorySave: fallbackIntent.needsMemorySave,
    memoryQuery: fallbackIntent.memoryQuery,
    confidence: fallbackIntent.confidence,
    estimatedOutputScale: fallbackIntent.estimatedOutputScale,
    outputBudget: {
      maxOutputTokens: outputBudget?.maxOutputTokens ?? null,
      requestTokenReserve: outputBudget?.requestTokenReserve ?? null,
      visibleOutputBudget: outputBudget?.visibleOutputBudget ?? null,
    },
  };

  try {
    const parsedIntent = await deps.generateObject(
      deps.exportIntentPrompt(),
      deps.exportUserPrompt(),
      {
        maxOutputTokens: 1024,
        modelProfile: deps.getTransportModelProfile("basic"),
        schema: IntentPredictionSchema,
        schemaName: "intent_prediction",
        schemaDescription: "Structured prediction for current user intent and topic relation.",
      },
    );
    predictedIntentInput = {
      ...predictedIntentInput,
      type: parsedIntent.type ?? fallbackIntent.type,
      topicRelation: parsedIntent.topicRelation ?? fallbackIntent.topicRelation,
      needsMemory: parsedIntent.needsMemory ?? fallbackIntent.needsMemory,
      needsMemorySave:
        parsedIntent.needsMemorySave ?? fallbackIntent.needsMemorySave,
      memoryQuery: parsedIntent.memoryQuery?.trim() ?? fallbackIntent.memoryQuery,
      confidence: parsedIntent.confidence ?? fallbackIntent.confidence,
      estimatedOutputScale:
        parsedIntent.estimatedOutputScale ?? fallbackIntent.estimatedOutputScale,
    };
  } catch {}

  deps.setPredictedIntent(task.sessionId, predictedIntentInput);

  const topicIsolation = deps.applyTopicIsolation(
    predictedIntentInput.topicRelation,
  );

  const policy = deps.resolveIntentPolicy(task.sessionId, {
    taskSource: task.source,
    chainRound: deps.getCurrentChainRound(),
    currentMemoryState: deps.getCurrentMemoryState(),
    sessionHistoryAvailable,
    shouldIsolateConversation: topicIsolation.shouldIsolateConversation,
  });

  const followUpPolicy = resolveLongOutputFollowUpPolicy({
    estimatedOutputScale: predictedIntentInput.estimatedOutputScale,
    chainRound: task.chainRound,
  });

  deps.logger?.debugJson("Intent predicted", {
    estimatedOutputScale: predictedIntentInput.estimatedOutputScale,
    chainRound: task.chainRound,
    followUpPolicy,
  });

  return createPrepareConversationIntentRequest(
    policy,
    followUpPolicy,
  );
};
