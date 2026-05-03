import { describe, expect, mock, test } from "bun:test";
import { runUserIntentPredictionWorkflow } from "@/core/workflows/runUserIntentPredictionWorkflow";
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
    source: overrides.source ?? TaskSource.EXTERNAL,
    workflow: overrides.workflow ?? TaskWorkflow.PREDICT_USER_INTENT,
    priority: overrides.priority ?? 1,
    eventTarget: overrides.eventTarget ?? undefined,
    channel: overrides.channel ?? { domain: "tui" },
    payload: overrides.payload ?? [{ type: "text", data: "预测一下" }],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...(typeof overrides.chainRound === "number"
      ? { chainRound: overrides.chainRound }
      : {}),
  } as TaskItem;
};

describe("runUserIntentPredictionWorkflow", () => {
  test("completes when no prediction request is produced", async () => {
    const task = buildTask("task-1");

    let currentTask: TaskItem | undefined;
    const runtime = {
      set currentTask(next) {
        currentTask = next;
      },
      get currentTask() {
        return currentTask;
      },
      prepareExecutionContext: mock(async () => null),
      executeIntentRequests: mock(async () => ({ status: "continue" })),
    };

    const updateTask = mock(() => {});
    const addTask = mock(async () => {});
    const taskQueue = {
      updateTask,
      addTask,
    };

    const result = await runUserIntentPredictionWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      {} as any,
    );

    expect(result).toEqual({
      type: "complete",
      task,
    });
    expect(runtime.prepareExecutionContext).toHaveBeenCalledWith(task);
    expect(runtime.executeIntentRequests).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith(
      task.id,
      { state: TaskState.COMPLETED },
      { shouldSyncEvent: false },
    );
    expect(addTask).not.toHaveBeenCalled();
  });

  test("completes current task when prediction execution continues", async () => {
    const task = buildTask("task-2");
    const predictionRequest = {
      request: "PREPARE_CONVERSATION",
    };

    let currentTask: TaskItem | undefined;
    const runtime = {
      set currentTask(next) {
        currentTask = next;
      },
      get currentTask() {
        return currentTask;
      },
      prepareExecutionContext: mock(async () => predictionRequest),
      executeIntentRequests: mock(async () => ({ status: "continue" })),
    };

    const updateTask = mock(() => {});
    const addTask = mock(async () => {});
    const taskQueue = {
      updateTask,
      addTask,
    };

    const result = await runUserIntentPredictionWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      {} as any,
    );

    expect(result).toEqual({
      type: "complete",
      task,
    });
    expect(runtime.executeIntentRequests).toHaveBeenCalledWith(
      task,
      [predictionRequest],
    );
    expect(updateTask).toHaveBeenCalledWith(
      task.id,
      { state: TaskState.COMPLETED },
      { shouldSyncEvent: false },
    );
    expect(addTask).not.toHaveBeenCalled();
  });

  test("returns enqueue when prediction execution yields nextTask", async () => {
    const task = buildTask("task-3");
    const nextTask = buildTask("task-3-next", {
      source: TaskSource.INTERNAL,
      workflow: TaskWorkflow.FORMAL_CONVERSATION,
      payload: [],
    });
    const predictionRequest = {
      request: "PREPARE_CONVERSATION",
    };

    let currentTask: TaskItem | undefined;
    const runtime = {
      set currentTask(next) {
        currentTask = next;
      },
      get currentTask() {
        return currentTask;
      },
      prepareExecutionContext: mock(async () => predictionRequest),
      executeIntentRequests: mock(async () => ({
        status: "stop",
        nextState: TaskState.FOLLOW_UP,
        nextTask,
      })),
    };

    const updateTask = mock(() => {});
    const addTask = mock(async () => {});
    const taskQueue = {
      updateTask,
      addTask,
    };

    const result = await runUserIntentPredictionWorkflow(
      task,
      taskQueue as any,
      runtime as any,
      {} as any,
    );

    expect(result).toEqual({
      type: "enqueue",
      nextTask,
    });
    expect(updateTask).toHaveBeenCalledWith(
      task.id,
      { state: TaskState.FOLLOW_UP },
      { shouldSyncEvent: false },
    );
    expect(addTask).not.toHaveBeenCalled();
  });
});
