// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { runPostFollowUpWorkflow } from "@/core/workflows/runPostFollowUpWorkflow";
import { TaskSource, TaskState, TaskWorkflow, type TaskItem } from "@/types/task";

const buildTask = (
  id: string,
  overrides: Partial<TaskItem & { chainRound?: number }> = {},
): TaskItem => {
  const now = Date.now();

  return {
    id,
    chainId: overrides.chainId ?? id,
    parentTaskId: overrides.parentTaskId ?? id,
    sessionId: overrides.sessionId ?? "session-1",
    chatId: overrides.chatId ?? "chat-1",
    state: overrides.state ?? TaskState.WAITING,
    source: overrides.source ?? TaskSource.INTERNAL,
    workflow: overrides.workflow ?? TaskWorkflow.POST_FOLLOW_UP,
    priority: overrides.priority ?? 1,
    eventTarget: overrides.eventTarget ?? undefined,
    channel: overrides.channel ?? { domain: "tui" },
    payload: overrides.payload ?? [{ type: "text", data: "继续后半部分" }],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...(typeof overrides.chainRound === "number"
      ? { chainRound: overrides.chainRound }
      : {}),
  } as TaskItem;
};

describe("runPostFollowUpWorkflow", () => {
  test("writes continuation and returns enqueue for continuation-driven formal conversation", async () => {
    const task = buildTask("task-1", {
      chainRound: 1,
      payload: [{ type: "text", data: "已完成前半部分，下一轮继续后半部分。" }],
    });
    const nextTask = buildTask("task-2", {
      chainId: "task-1",
      parentTaskId: "task-1",
      workflow: TaskWorkflow.FORMAL_CONVERSATION,
      payload: [],
      chainRound: 1,
    });

    let currentTask;
    const preparePostFollowUpContinuation = mock(async () => ({
      summary: "已完成前半部分。",
      nextPrompt: "继续后半部分。",
      avoidRepeat: "不要重复前文。",
      fallbackUsed: false,
    }));
    const createContinuationFormalConversationTask = mock(() => nextTask);
    const runtime = {
      set currentTask(next) {
        currentTask = next;
      },
      get currentTask() {
        return currentTask;
      },
      preparePostFollowUpContinuation,
      createContinuationFormalConversationTask,
    };

    const updateTask = mock(() => {});
    const addTask = mock(async () => {});
    const taskQueue = {
      updateTask,
      addTask,
    };

    const result = await runPostFollowUpWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      {} as any,
    );

    expect(result).toEqual({
      type: "enqueue",
      nextTask,
    });
    expect(preparePostFollowUpContinuation).toHaveBeenCalledTimes(1);
    expect(createContinuationFormalConversationTask).toHaveBeenCalledWith(task);
    expect(updateTask).toHaveBeenCalledWith(
      task.id,
      { state: TaskState.COMPLETED },
      { shouldSyncEvent: false },
    );
    expect(addTask).not.toHaveBeenCalled();
  });
});
