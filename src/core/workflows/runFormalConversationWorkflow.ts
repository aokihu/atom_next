import {
  PipelineRunner,
  RuntimeEventBus,
  type PipelineContext,
} from "@/core/pipeline";
import type { TaskItem } from "@/types/task";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";
import type { Transport } from "../transport";
import type {
  FormalConversationWorkflowEnv,
  RunFormalConversationWorkflowResult,
} from "./formal-conversation/types";
import { subscribeFormalConversationTransportEvents } from "./formal-conversation/transport-event-handler";
import { createFormalConversationPipelineState } from "./formal-conversation/types";
import { finalizeConversationElement } from "./formal-conversation/elements/finalize-conversation.element";
import {
  createFormalConversationPrepareAndTransportPipeline,
  formalConversationIntentRequestPipeline,
} from "./formal-conversation/pipeline";
export type { RunFormalConversationWorkflowResult } from "./formal-conversation/types";

export type RunFormalConversationWorkflowOptions = {
  eventBus?: RuntimeEventBus;
  signal?: AbortSignal;
};

/* ==================== */
/* Workflow Constructors */
/* ==================== */

/**
 * 创建 formal conversation workflow 的稳定运行环境。
 * @description
 * env 只保留无法通过函数计算得到、必须从外部注入的运行依赖：
 * - 当前 task
 * - queue / runtime
 *
 * 所有中间结果都通过 step 返回值显式向下游传递。
 */
function createFormalConversationWorkflowEnv(
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
): FormalConversationWorkflowEnv {
  return {
    task,
    taskQueue,
    runtime,
  };
}

/* ==================== */
/* Public Workflow      */
/* ==================== */

export const runFormalConversationWorkflow = async (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  transport: Transport,
  options: RunFormalConversationWorkflowOptions = {},
): Promise<RunFormalConversationWorkflowResult> => {
  const eventBus = options.eventBus ?? new RuntimeEventBus();
  const runner = new PipelineRunner();
  const pipelineState = createFormalConversationPipelineState();
  const context: PipelineContext = {
    run: {
      taskId: task.id,
      chainId: task.chainId,
    },
    eventBus,
    signal: options.signal,
  };
  const env = createFormalConversationWorkflowEnv(task, taskQueue, runtime);
  const unsubscribeTransportEvents = subscribeFormalConversationTransportEvents(
    eventBus,
    env,
    pipelineState,
  );

  try {
    const toolBoundaryResult = await runner.run(
      createFormalConversationPrepareAndTransportPipeline({
        transport,
        state: pipelineState,
      }),
      env,
      context,
    );

    if (toolBoundaryResult.type === "resolved") {
      return finalizeConversationElement.process(toolBoundaryResult.applied, context);
    }

    return runner.run(
      formalConversationIntentRequestPipeline,
      toolBoundaryResult.output,
      context,
    );
  } finally {
    unsubscribeTransportEvents();
  }
};
