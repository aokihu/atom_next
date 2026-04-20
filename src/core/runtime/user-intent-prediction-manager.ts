import type { EmptyString, UUID } from "@/types";
import {
  createPredictedIntent,
  type PredictedIntent,
} from "./intent-prediction";
import {
  createIntentExecutionPolicy,
  resolveIntentPolicy,
  type IntentControlInput,
  type IntentExecutionPolicy,
} from "./intent-policy";
import { convertIntentPolicyToPrompt } from "./context-prompt";

type PredictionIntentSessionContext = {
  predictedIntent: PredictedIntent;
  intentPolicy: IntentExecutionPolicy;
};

const createPredictionIntentSessionContext =
  (): PredictionIntentSessionContext => {
    return {
      predictedIntent: createPredictedIntent(),
      intentPolicy: createIntentExecutionPolicy(),
    };
  };

type ResolvePredictionIntentPolicyInput = Omit<
  IntentControlInput,
  "predictedIntent"
>;

/**
 * 管理 session 级的用户输入意图预测结果与执行策略。
 * @description
 * 该对象只负责“用户输入预测结果 -> 策略结果”这条链路，
 * 不参与 Runtime 的任务同步、对话上下文或记忆上下文编排。
 * 这样 Runtime 可以把用户意图预测能力委托出去，降低主类复杂度。
 */
export class UserIntentPredictionManager {
  #sessionContexts: Map<UUID, PredictionIntentSessionContext>;

  constructor() {
    this.#sessionContexts = new Map();
  }

  /**
   * 读取指定 session 的 prediction 状态。
   * @description
   * 空 session 返回一次性默认值，不落库；
   * 有效 session 则按需初始化并复用。
   */
  #readSessionContext(sessionId: UUID | EmptyString) {
    if (!sessionId) {
      return createPredictionIntentSessionContext();
    }

    let sessionContext = this.#sessionContexts.get(sessionId as UUID);

    if (!sessionContext) {
      sessionContext = createPredictionIntentSessionContext();
      this.#sessionContexts.set(sessionId as UUID, sessionContext);
    }

    return sessionContext;
  }

  public setFallbackPredictedIntent(sessionId: UUID | EmptyString) {
    const fallbackIntent = createPredictedIntent();

    this.setPredictedIntent(sessionId, {
      sessionId,
      type: fallbackIntent.type,
      needsMemory: fallbackIntent.needsMemory,
      needsMemorySave: fallbackIntent.needsMemorySave,
      memoryQuery: fallbackIntent.memoryQuery,
      confidence: fallbackIntent.confidence,
    });
  }

  public setPredictedIntent(
    sessionId: UUID | EmptyString,
    input: Omit<PredictedIntent, "updatedAt">,
  ) {
    this.#readSessionContext(sessionId).predictedIntent = {
      ...input,
      updatedAt: Date.now(),
    };
  }

  public clearPredictedIntent(sessionId: UUID | EmptyString) {
    this.#readSessionContext(sessionId).predictedIntent = createPredictedIntent();
  }

  public getPredictedIntent(sessionId: UUID | EmptyString) {
    return structuredClone(this.#readSessionContext(sessionId).predictedIntent);
  }

  public resolveIntentPolicy(
    sessionId: UUID | EmptyString,
    input: ResolvePredictionIntentPolicyInput,
  ) {
    const resolvedPolicy = resolveIntentPolicy({
      ...input,
      predictedIntent: this.getPredictedIntent(sessionId),
    });

    this.setIntentPolicy(sessionId, {
      sessionId,
      acceptedIntentType: resolvedPolicy.acceptedIntentType,
      preloadMemory: resolvedPolicy.preloadMemory,
      memoryQuery: resolvedPolicy.memoryQuery,
      allowMemorySave: resolvedPolicy.allowMemorySave,
      maxFollowUpRounds: resolvedPolicy.maxFollowUpRounds,
      promptVariant: resolvedPolicy.promptVariant,
      predictionTrust: resolvedPolicy.predictionTrust,
      reasons: resolvedPolicy.reasons,
    });

    return this.getIntentPolicy(sessionId);
  }

  public setIntentPolicy(
    sessionId: UUID | EmptyString,
    input: Omit<IntentExecutionPolicy, "updatedAt">,
  ) {
    this.#readSessionContext(sessionId).intentPolicy = {
      ...input,
      updatedAt: Date.now(),
    };
  }

  public clearIntentPolicy(sessionId: UUID | EmptyString) {
    this.#readSessionContext(sessionId).intentPolicy =
      createIntentExecutionPolicy();
  }

  public getIntentPolicy(sessionId: UUID | EmptyString) {
    return structuredClone(this.#readSessionContext(sessionId).intentPolicy);
  }

  /**
   * 导出当前 session 的 IntentPolicy 提示词片段。
   */
  public exportIntentPolicyPrompt(sessionId: UUID | EmptyString) {
    return convertIntentPolicyToPrompt(this.getIntentPolicy(sessionId));
  }
}
