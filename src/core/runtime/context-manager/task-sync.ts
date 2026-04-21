/**
 * context-manager/task-sync.ts
 * @description
 * 收口 ContextManager 在 task 激活阶段使用的纯状态迁移规则。
 *
 * 这个文件只处理：
 * - task 文本提取
 * - chain round 解析
 * - session round 计算
 * - follow-up 上下文迁移
 *
 * 它不持有状态，也不直接操作 ContextManager 实例，
 * 所有函数都应保持“输入确定，输出确定”的纯函数形式。
 */
import { TaskSource, type TaskItem } from "@/types/task";
import { isNumber } from "radashi";
import { createRuntimeFollowUpContext } from "./state";
import type {
  RuntimeFollowUpContext,
  RuntimeTaskSession,
  SyncFollowUpContextInput,
  SyncTaskSessionResult,
} from "./types";

/* ==================== */
/* Task Parsing         */
/* ==================== */

/**
 * 导出 task 中可视为用户输入的文本内容。
 * @description
 * ContextManager 只在 follow-up originalUserInput 同步时使用这份文本，
 * 这里保持为纯提取函数，不让状态对象自己承担文本拼接规则。
 */
export const exportTaskUserInput = (task: TaskItem): string => {
  return task.payload
    .filter((payload) => payload.type === "text")
    .map((payload) => payload.data)
    .join("\n");
};

/**
 * 解析 task 携带的 chain round。
 * @description
 * 非法 round 一律按 null 处理，避免把异常值写入 follow-up 状态。
 */
export const parseTaskChainRound = (task: TaskItem): number | null => {
  const chainRound = task.chain_round;

  if (!isNumber(chainRound) || chainRound < 1) {
    return null;
  }

  return chainRound;
};

/* ==================== */
/* Task Sync Rules      */
/* ==================== */

/**
 * 同步当前 task 对应的 session round。
 * @description
 * 这里纯粹根据 taskSessions 和当前 task 计算 round，
 * 不直接修改 ContextManager 内部状态，方便后续继续拆分测试。
 */
export const syncTaskSessions = (
  taskSessions: RuntimeTaskSession[],
  task: TaskItem,
): SyncTaskSessionResult => {
  const existingTaskSession = taskSessions.find((item) => {
    return item.sessionId === task.sessionId && item.chatId === task.chatId;
  });

  if (existingTaskSession) {
    return {
      round: existingTaskSession.round,
      taskSessions,
    };
  }

  const sessionRounds = taskSessions
    .filter((item) => item.sessionId === task.sessionId)
    .map((item) => item.round);
  const nextRound = sessionRounds.length === 0 ? 1 : Math.max(...sessionRounds) + 1;

  return {
    round: nextRound,
    taskSessions: [
      ...taskSessions,
      {
        sessionId: task.sessionId,
        chatId: task.chatId,
        round: nextRound,
      },
    ],
  };
};

/**
 * 计算下一个 follow-up 上下文。
 * @description
 * 只负责状态迁移规则：
 * - chat 切换时清空累计输出
 * - external task 重写 originalUserInput
 * - internal task 在跨会话/跨 chat 时清空原始输入
 */
export const syncFollowUpContext = (
  input: SyncFollowUpContextInput,
): RuntimeFollowUpContext => {
  const previousFollowUp =
    input.previousFollowUp ?? createRuntimeFollowUpContext();
  const hasSessionChanged = input.previousSessionId !== input.task.sessionId;
  const hasChatChanged = previousFollowUp.chatId !== input.task.chatId;

  const nextFollowUp: RuntimeFollowUpContext = {
    ...previousFollowUp,
    chatId: input.task.chatId,
    chainRound: parseTaskChainRound(input.task),
  };

  if (hasChatChanged) {
    nextFollowUp.accumulatedAssistantOutput = "";
    nextFollowUp.lastAssistantOutput = "";
  }

  if (input.task.source === TaskSource.EXTERNAL) {
    nextFollowUp.originalUserInput = exportTaskUserInput(input.task);
    return nextFollowUp;
  }

  if (hasChatChanged || hasSessionChanged) {
    nextFollowUp.originalUserInput = "";
  }

  return nextFollowUp;
};
