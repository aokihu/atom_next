import type { TaskItem } from "@/types/task";
import { TaskState } from "@/types";
import { promiseChain } from "radashi";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";
import type { Transport } from "../transport";

/* ==================== */
/* Workflow Types       */
/* ==================== */

type UserIntentPredictionWorkflowEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
  transport: Transport;
};

type PreparedPredictionRequest = {
  env: UserIntentPredictionWorkflowEnv;
  predictionRequest: Awaited<ReturnType<Runtime["prepareExecutionContext"]>>;
};

type PredictionExecution = {
  env: UserIntentPredictionWorkflowEnv;
  requestExecutionResult?: Awaited<
    ReturnType<Runtime["executeIntentRequests"]>
  >;
};

/* ==================== */
/* Workflow Constructors */
/* ==================== */

/**
 * 创建 user intent prediction workflow 的稳定运行环境。
 * @description
 * 这里只放无法通过函数计算得到、必须由外部注入的运行依赖：
 * - 当前 task
 * - queue / runtime / transport
 *
 * 中间结果不放在 env 中，而是通过 step 返回值显式传递。
 */
function createUserIntentPredictionWorkflowEnv(
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  transport: Transport,
): UserIntentPredictionWorkflowEnv {
  return {
    task,
    taskQueue,
    runtime,
    transport,
  };
}

/* ==================== */
/* Workflow Steps       */
/* ==================== */

/**
 * 将当前 task 同步到 runtime。
 * @description
 * 这是 workflow 的起点：
 * 后续所有 runtime 相关操作都依赖 currentTask 已经就位。
 *
 * 这里返回 env 本身，是为了继续交给 promiseChain 的后续 step。
 */
async function syncRuntimeTask(
  env: UserIntentPredictionWorkflowEnv,
): Promise<UserIntentPredictionWorkflowEnv> {
  env.runtime.currentTask = env.task;
  return env;
}

/**
 * 生成本轮需要执行的预测请求。
 * @description
 * Runtime 会根据当前 task 和 transport 生成一个
 * `PrepareConversationIntentRequest | null`：
 * - external task 通常会返回请求
 * - internal task 会直接返回 null
 *
 * 这里不修改共享对象，而是把 predictionRequest 作为 step 结果显式返回。
 */
async function preparePredictionRequest(
  env: UserIntentPredictionWorkflowEnv,
): Promise<PreparedPredictionRequest> {
  return {
    env,
    predictionRequest: await env.runtime.prepareExecutionContext(
      env.task,
      env.transport,
    ),
  };
}

/**
 * 执行 prepare 阶段生成的预测请求。
 * @description
 * 如果 prepare 阶段没有生成请求，则直接把 env 继续向下传，
 * 让 apply 阶段自行决定这轮没有任何执行结果时该如何收束。
 */
async function executePredictionRequest(
  input: PreparedPredictionRequest,
): Promise<PredictionExecution> {
  if (!input.predictionRequest) {
    return {
      env: input.env,
    };
  }

  return {
    env: input.env,
    requestExecutionResult: await input.env.runtime.executeIntentRequests(
      input.env.task,
      [input.predictionRequest],
    ),
  };
}

/**
 * 将 intent request 的执行结果应用到 queue。
 * @description
 * 这里是这条 workflow 的最终落点：
 * - `continue`：当前预测任务到此完成
 * - `stop`：根据 result.nextState / result.nextTask 推进后续链路
 *
 * 这个 step 只负责把执行结果落到 queue，不再额外返回中间状态。
 */
async function applyPredictionExecution(
  input: PredictionExecution,
): Promise<void> {
  const result = input.requestExecutionResult;

  if (!result) {
    return;
  }

  if (result.status === "continue") {
    input.env.taskQueue.updateTask(
      input.env.task.id,
      { state: TaskState.COMPLETE },
      { shouldSyncEvent: false },
    );

    return;
  }

  if (result.nextState) {
    input.env.taskQueue.updateTask(
      input.env.task.id,
      { state: result.nextState },
      { shouldSyncEvent: false },
    );
  }

  if (result.nextTask) {
    await input.env.taskQueue.addTask(result.nextTask);
  }
}

/* ==================== */
/* Public Workflow      */
/* ==================== */

export const runUserIntentPredictionWorkflow = async (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  transport: Transport,
) => {
  /**
   * 保留 promiseChain 的原因：
   * - step 顺序清晰
   * - 异常统一向上冒泡
   * - 错误处理可以继续集中在 workflow 之外收口
   */
  return promiseChain(
    syncRuntimeTask,
    preparePredictionRequest,
    executePredictionRequest,
    applyPredictionExecution,
  )(
    createUserIntentPredictionWorkflowEnv(
      task,
      taskQueue,
      runtime,
      transport,
    ),
  ).then(() => undefined);
};
