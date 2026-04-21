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
import { TaskSource } from "@/types/task";
import type { IntentExecutionPolicy } from "../user-intent";
import { parseIntentPredictionText } from "../user-intent";
import type { PrepareExecutionContext } from "./types";

/* ==================== */
/* Request Builder      */
/* ==================== */

/**
 * 根据已解析的 intent policy 构造 PREPARE_CONVERSATION 请求。
 * @description
 * prepare 子域只负责把预处理结果转成统一请求对象，
 * 真正的请求执行仍由 intent-request/execution 子域负责。
 */
export function buildPrepareConversationIntentRequest(
  policy: IntentExecutionPolicy,
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

  try {
    const predictionText = await deps.transport.generateText(
      deps.exportIntentPrompt(),
      deps.exportUserPrompt(),
      {
        maxOutputTokens: 120,
        modelProfile: deps.getTransportModelProfile("basic"),
      },
    );
    const parsedIntent = parseIntentPredictionText(predictionText);

    deps.setPredictedIntent(task.sessionId, {
      sessionId: task.sessionId,
      type: parsedIntent.type,
      needsMemory: parsedIntent.needsMemory,
      needsMemorySave: parsedIntent.needsMemorySave,
      memoryQuery: parsedIntent.memoryQuery,
      confidence: parsedIntent.confidence,
    });
  } catch {
    deps.setFallbackPredictedIntent(task.sessionId);
  }

  const policy = deps.resolveIntentPolicy(task.sessionId, {
    taskSource: task.source,
    chainRound: deps.getCurrentChainRound(),
    currentMemoryState: deps.getCurrentMemoryState(),
    sessionHistoryAvailable: deps.hasSessionHistory(),
  });

  return buildPrepareConversationIntentRequest(policy);
};
