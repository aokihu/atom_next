/**
 * prepare/types.ts
 * @description
 * 定义 Runtime prepare 子域使用的输入输出类型。
 *
 * 这个子域专门负责 external task 进入正式对话前的预处理链路：
 * - 用户意图预测
 * - fallback 预测写入
 * - intent policy 解析
 * - PREPARE_CONVERSATION 请求构造
 *
 * 这里仅声明 prepare 流程所需的依赖形状，
 * 不放具体流程实现。
 */
import type {
  PrepareConversationIntentRequest,
} from "@/types";
import type { RuntimeOutputBudget } from "@/services/runtime";
import type { TaskItem } from "@/types/task";
import type { Transport, TransportModelProfile } from "../../transport";
import type {
  IntentControlInput,
  IntentExecutionPolicy,
  PredictedIntent,
} from "../user-intent";

/* ==================== */
/* Shared Types         */
/* ==================== */

export type PrepareMemoryState = {
  core: "idle" | "loaded" | "empty";
  short: "idle" | "loaded" | "empty";
  long: "idle" | "loaded" | "empty";
};

/* ==================== */
/* Dependency Types     */
/* ==================== */

export type PrepareExecutionContextDeps = {
  transport: Transport;
  exportIntentPrompt: () => string;
  exportUserPrompt: () => string;
  getTransportModelProfile: (
    level?: TransportModelProfile["level"],
  ) => TransportModelProfile;
  setPredictedIntent: (
    sessionId: string,
    input: Omit<PredictedIntent, "updatedAt">,
  ) => void;
  setFallbackPredictedIntent: (sessionId: string) => void;
  resolveIntentPolicy: (
    sessionId: string,
    input: Omit<IntentControlInput, "predictedIntent">,
  ) => IntentExecutionPolicy;
  getCurrentChainRound: () => number | null;
  getCurrentMemoryState: () => PrepareMemoryState;
  hasSessionHistory: () => boolean;
  getFormalConversationOutputBudget: () => RuntimeOutputBudget | null;
};

/* ==================== */
/* Public API Types     */
/* ==================== */

export type PrepareExecutionContext = (
  task: TaskItem,
  deps: PrepareExecutionContextDeps,
) => Promise<PrepareConversationIntentRequest | null>;
