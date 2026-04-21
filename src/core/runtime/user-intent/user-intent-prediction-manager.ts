/**
 * user-intent/user-intent-prediction-manager.ts
 * @description
 * 持有 user-intent 子域的 session 级运行时状态。
 *
 * 这个对象只负责两件事：
 * - 保存每个 session 最近一次预测结果
 * - 保存并导出每个 session 当前解析出的 intent policy
 *
 * 它不负责模型调用，也不负责任务/对话上下文同步。
 */
import { convertIntentPolicyToPrompt } from "../prompt";
import {
  resolveIntentPolicy,
  type IntentExecutionPolicy,
} from "./intent-policy";
import { createPredictedIntent, type PredictedIntent } from "./intent-prediction";
import { createIntentExecutionPolicy } from "./intent-policy";
import { createPredictionIntentSessionContext } from "./state";
import type {
  PredictionIntentSessionContext,
  ResolvePredictionIntentPolicyInput,
  UserIntentSessionId,
} from "./types";

/* ==================== */
/* Session Manager      */
/* ==================== */

/**
 * 管理 session 级的用户输入意图预测结果与执行策略。
 * @description
 * 该对象只负责“用户输入预测结果 -> 策略结果”这条链路，
 * 不参与 Runtime 的任务同步、对话上下文或记忆上下文编排。
 * 这样 Runtime 可以把用户意图预测能力委托出去，降低主类复杂度。
 */
export class UserIntentPredictionManager {
  #sessionContexts: Map<string, PredictionIntentSessionContext>;

  constructor() {
    this.#sessionContexts = new Map();
  }

  /**
   * 读取指定 session 的 prediction 状态。
   * @description
   * 空 session 返回一次性默认值，不落库；
   * 有效 session 则按需初始化并复用。
   */
  #readSessionContext(sessionId: UserIntentSessionId) {
    if (!sessionId) {
      return createPredictionIntentSessionContext();
    }

    let sessionContext = this.#sessionContexts.get(sessionId);

    if (!sessionContext) {
      sessionContext = createPredictionIntentSessionContext();
      this.#sessionContexts.set(sessionId, sessionContext);
    }

    return sessionContext;
  }

  /* ==================== */
  /* Predicted Intent     */
  /* ==================== */

  public setFallbackPredictedIntent(sessionId: UserIntentSessionId) {
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
    sessionId: UserIntentSessionId,
    input: Omit<PredictedIntent, "updatedAt">,
  ) {
    this.#readSessionContext(sessionId).predictedIntent = {
      ...input,
      updatedAt: Date.now(),
    };
  }

  public clearPredictedIntent(sessionId: UserIntentSessionId) {
    this.#readSessionContext(sessionId).predictedIntent = createPredictedIntent();
  }

  public getPredictedIntent(sessionId: UserIntentSessionId) {
    return structuredClone(this.#readSessionContext(sessionId).predictedIntent);
  }

  /* ==================== */
  /* Intent Policy       */
  /* ==================== */

  public resolveIntentPolicy(
    sessionId: UserIntentSessionId,
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
    sessionId: UserIntentSessionId,
    input: Omit<IntentExecutionPolicy, "updatedAt">,
  ) {
    this.#readSessionContext(sessionId).intentPolicy = {
      ...input,
      updatedAt: Date.now(),
    };
  }

  public clearIntentPolicy(sessionId: UserIntentSessionId) {
    this.#readSessionContext(sessionId).intentPolicy =
      createIntentExecutionPolicy();
  }

  public getIntentPolicy(sessionId: UserIntentSessionId) {
    return structuredClone(this.#readSessionContext(sessionId).intentPolicy);
  }

  /**
   * 导出当前 session 的 IntentPolicy 提示词片段。
   */
  public exportIntentPolicyPrompt(sessionId: UserIntentSessionId) {
    return convertIntentPolicyToPrompt(this.getIntentPolicy(sessionId));
  }
}
