import type { TaskItem } from "@/types/task";
import type { ServiceManager } from "@/libs/service-manage";
import { TaskState } from "@/types";
import { promiseChain } from "radashi";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";

type PostFollowUpWorkflowEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
};

type PreparedPostFollowUp = {
  env: PostFollowUpWorkflowEnv;
  nextTask: ReturnType<Runtime["createContinuationFormalConversationTask"]>;
};

function createPostFollowUpWorkflowEnv(
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
): PostFollowUpWorkflowEnv {
  return {
    task,
    taskQueue,
    runtime,
  };
}

async function syncRuntimeTask(
  env: PostFollowUpWorkflowEnv,
): Promise<PostFollowUpWorkflowEnv> {
  env.runtime.currentTask = env.task;
  return env;
}

async function prepareContinuation(
  env: PostFollowUpWorkflowEnv,
): Promise<PreparedPostFollowUp> {
  await env.runtime.preparePostFollowUpContinuation();

  return {
    env,
    nextTask: env.runtime.createContinuationFormalConversationTask(env.task),
  };
}

async function applyPostFollowUp(
  input: PreparedPostFollowUp,
): Promise<void> {
  input.env.taskQueue.updateTask(
    input.env.task.id,
    { state: TaskState.COMPLETED },
    { shouldSyncEvent: false },
  );
  await input.env.taskQueue.addTask(input.nextTask);
}

export const runPostFollowUpWorkflow = async (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  _serviceManager: ServiceManager,
) => {
  return promiseChain(
    syncRuntimeTask,
    prepareContinuation,
    applyPostFollowUp,
  )(
    createPostFollowUpWorkflowEnv(
      task,
      taskQueue,
      runtime,
    ),
  ).then(() => undefined);
};
