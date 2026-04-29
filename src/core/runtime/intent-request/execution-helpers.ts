/**
 * intent-request/execution-helpers.ts
 * @description
 * 提供 Intent Request 执行阶段共用的纯函数和任务构造工具。
 *
 * 这个文件只放执行阶段的共享 helper，
 * 不直接调度执行流程。
 */
import { createInternalTaskItem } from "@/libs";
import type {
  FollowUpIntentRequest,
  FollowUpWithToolsIntentRequest,
  MemoryScope,
  SearchMemoryIntentRequest,
} from "@/types";
import { TaskSource, TaskWorkflow, type TaskItem } from "@/types/task";
import { isNumber } from "radashi";
import type { RuntimeIntentRequestExecutionContext } from "./types";

/* ==================== */
/* Scope / Round Helper */
/* ==================== */

export const resolveMemoryScope = (scope?: string): MemoryScope => {
  return (scope ?? "long") as MemoryScope;
};

const parseTaskChainRound = (task: TaskItem) => {
  const round = task.chainRound;

  if (!isNumber(round) || round < 1) {
    return 0;
  }

  return round;
};

/* ==================== */
/* Task Builders        */
/* ==================== */

export const createFollowUpTask = (
  task: TaskItem,
  request: FollowUpIntentRequest,
) => {
  const nextChainRound = parseTaskChainRound(task) + 1;

  return createInternalTaskItem({
    sessionId: task.sessionId,
    chatId: task.chatId,
    chainId: task.chainId,
    parentTaskId: task.id,
    chainRound: nextChainRound,

    priority: 1,
    eventTarget: task.eventTarget,
    channel: task.channel,
    workflow: TaskWorkflow.POST_FOLLOW_UP,
    payload: [
      {
        type: "text",
        data: request.intent,
      },
    ],
  });
};

/**
 * 构造一个只依赖 continuation context 的 internal follow-up task。
 * @description
 * FOLLOW_UP_WITH_TOOLS 的续跑说明不再写入 payload，
 * 下一轮 formal conversation 只通过 Runtime Context 读取 continuation。
 */
export const createFollowUpWithToolsTask = (
  task: TaskItem,
  request: FollowUpWithToolsIntentRequest,
) => {
  const nextChainRound = parseTaskChainRound(task) + 1;

  return createInternalTaskItem({
    sessionId: task.sessionId,
    chatId: task.chatId,
    chainId: task.chainId,
    parentTaskId: task.id,
    chainRound: nextChainRound,
    priority: 1,
    eventTarget: task.eventTarget,
    channel: task.channel,
    payload: [],
  });
};

export const createRepeatedSearchClosureTask = (
  task: TaskItem,
  searchRequest: SearchMemoryIntentRequest,
  memoryStatus: "loaded" | "empty",
  reason: "repeated_search" | "missing_follow_up",
) => {
  const nextChainRound = parseTaskChainRound(task) + 1;
  const summary = memoryStatus === "loaded"
    ? "系统已经完成该记忆搜索，结果已写入 <Memory>。"
    : "系统已经完成该记忆搜索，但 <Memory> 没有命中。";
  const triggerReason = reason === "repeated_search"
    ? "重复搜索已被 Core 拦截。"
    : "本轮 SEARCH_MEMORY 已执行，但模型没有提交 FOLLOW_UP。";

  return createInternalTaskItem({
    sessionId: task.sessionId,
    chatId: task.chatId,
    chainId: task.chainId,
    parentTaskId: task.id,
    chainRound: nextChainRound,
    priority: 1,
    eventTarget: task.eventTarget,
    channel: task.channel,
    payload: [
      {
        type: "text",
        data: [
          `${triggerReason}${summary}`,
          `当前搜索 query = ${searchRequest.params.words.trim()}`,
          "不要再次发起 SEARCH_MEMORY 或 FOLLOW_UP。",
          "请直接基于当前 <Memory>、OriginalUserInput 和已累计输出给出最终回答，不要重复已经输出的内容。",
        ].join("\n"),
      },
    ],
  });
};

export const createFormalConversationTask = (task: TaskItem) => {
  return createInternalTaskItem({
    sessionId: task.sessionId,
    chatId: task.chatId,
    chainId: task.chainId,
    parentTaskId: task.id,
    chainRound: task.chainRound,
    priority: 1,
    eventTarget: task.eventTarget,
    channel: task.channel,
    payload: task.payload,
    workflow: TaskWorkflow.FORMAL_CONVERSATION,
  });
};

export const createContinuationFormalConversationTask = (task: TaskItem) => {
  return createInternalTaskItem({
    sessionId: task.sessionId,
    chatId: task.chatId,
    chainId: task.chainId,
    parentTaskId: task.id,
    chainRound: task.chainRound,
    priority: 1,
    eventTarget: task.eventTarget,
    channel: task.channel,
    payload: [],
    workflow: TaskWorkflow.FORMAL_CONVERSATION,
  });
};

/* ==================== */
/* Execution Guard      */
/* ==================== */

export const shouldSkipRepeatedSearchMemory = (
  task: TaskItem,
  request: SearchMemoryIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
) => {
  if (task.source !== TaskSource.INTERNAL) {
    return false;
  }

  const scope = resolveMemoryScope(request.params.scope);
  const memoryContext = context.getMemoryContext(scope);

  return (
    memoryContext.status !== "idle" &&
    memoryContext.query === request.params.words.trim()
  );
};
