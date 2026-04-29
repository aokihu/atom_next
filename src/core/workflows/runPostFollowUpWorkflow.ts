import type { TaskItem } from "@/types/task";
import { TaskState } from "@/types";
import { promiseChain } from "radashi";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";
import type { Transport } from "../transport";

type PostFollowUpWorkflowEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
  transport: Transport;
};

type PreparedPostFollowUp = {
  env: PostFollowUpWorkflowEnv;
  nextTask: ReturnType<Runtime["createContinuationFormalConversationTask"]>;
};

function createPostFollowUpWorkflowEnv(
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  transport: Transport,
): PostFollowUpWorkflowEnv {
  return {
    task,
    taskQueue,
    runtime,
    transport,
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
  await env.runtime.preparePostFollowUpContinuation(env.transport);

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
  transport: Transport,
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
      transport,
    ),
  ).then(() => undefined);
};
