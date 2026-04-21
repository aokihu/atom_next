import type { TaskItem } from "@/types/task";
import { TaskState } from "@/types";
import { promiseChain } from "radashi";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";
import type { Transport } from "../transport";

type RunUserIntentPredictionWorkflowContext = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
  transport: Transport;
  predictionRequest: Awaited<ReturnType<Runtime["prepareExecutionContext"]>>;
  requestExecutionResult?: Awaited<
    ReturnType<Runtime["executeIntentRequests"]>
  >;
};

const createRunUserIntentPredictionWorkflowContext = (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  transport: Transport,
): RunUserIntentPredictionWorkflowContext => {
  return {
    task,
    taskQueue,
    runtime,
    transport,
    predictionRequest: null,
  };
};

const syncRuntimeTask = async (
  context: RunUserIntentPredictionWorkflowContext,
) => {
  context.runtime.currentTask = context.task;
  return context;
};

const preparePredictionRequest = async (
  context: RunUserIntentPredictionWorkflowContext,
) => {
  context.predictionRequest = await context.runtime.prepareExecutionContext(
    context.task,
    context.transport,
  );
  return context;
};

const executePredictionRequest = async (
  context: RunUserIntentPredictionWorkflowContext,
) => {
  if (!context.predictionRequest) {
    return context;
  }

  context.requestExecutionResult = await context.runtime.executeIntentRequests(
    context.task,
    [context.predictionRequest],
  );

  return context;
};

const applyPredictionExecution = async (
  context: RunUserIntentPredictionWorkflowContext,
) => {
  const result = context.requestExecutionResult;

  if (!result) {
    return context;
  }

  if (result.status === "continue") {
    context.taskQueue.updateTask(
      context.task.id,
      { state: TaskState.COMPLETE },
      { shouldSyncEvent: false },
    );

    return context;
  }

  if (result.nextState) {
    context.taskQueue.updateTask(
      context.task.id,
      { state: result.nextState },
      { shouldSyncEvent: false },
    );
  }

  if (result.nextTask) {
    await context.taskQueue.addTask(result.nextTask);
  }

  return context;
};

export type RunUserIntentPredictionWorkflowResult = {
  hasScheduledFormalConversation: boolean;
};

export const runUserIntentPredictionWorkflow = async (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  transport: Transport,
) => {
  return promiseChain(
    syncRuntimeTask,
    preparePredictionRequest,
    executePredictionRequest,
    applyPredictionExecution,
  )(
    createRunUserIntentPredictionWorkflowContext(
      task,
      taskQueue,
      runtime,
      transport,
    ),
  ).then((context): RunUserIntentPredictionWorkflowResult => {
    return {
      hasScheduledFormalConversation:
        context.requestExecutionResult?.status === "stop",
    };
  });
};
