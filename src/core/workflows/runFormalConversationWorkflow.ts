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
import { applyIntentRequestExecutionElement } from "./formal-conversation/elements/apply-intent-request-execution.element";
import { executeIntentRequestsElement } from "./formal-conversation/elements/execute-intent-requests.element";
import { finalizeConversationElement } from "./formal-conversation/elements/finalize-conversation.element";
import { parseIntentRequestsElement } from "./formal-conversation/elements/parse-intent-requests.element";
import { formalConversationPrepareAndTransportPipeline } from "./formal-conversation/pipeline";
export type { RunFormalConversationWorkflowResult } from "./formal-conversation/types";

/* ==================== */
/* Workflow Constructors */
/* ==================== */

/**
 * 创建 formal conversation workflow 的稳定运行环境。
 * @description
 * env 只保留无法通过函数计算得到、必须从外部注入的运行依赖：
 * - 当前 task
 * - queue / runtime / transport
 *
 * 所有中间结果都通过 step 返回值显式向下游传递。
 */
function createFormalConversationWorkflowEnv(
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  transport: Transport,
): FormalConversationWorkflowEnv {
  return {
    task,
    taskQueue,
    runtime,
    transport,
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
): Promise<RunFormalConversationWorkflowResult> => {
  const eventBus = new RuntimeEventBus();
  const runner = new PipelineRunner();
  const context: PipelineContext = {
    task,
    runtime,
    transport,
    eventBus,
  };
  const env = createFormalConversationWorkflowEnv(
    task,
    taskQueue,
    runtime,
    transport,
  );
  const toolBoundaryResult = await runner.run(
    formalConversationPrepareAndTransportPipeline,
    env,
    context,
  );

  if (toolBoundaryResult.type === "resolved") {
    return finalizeConversationElement.process(toolBoundaryResult.applied, context);
  }

  const parsed = await parseIntentRequestsElement.process(
    toolBoundaryResult.output,
    context,
  );
  const executed = await executeIntentRequestsElement.process(parsed, context);
  const applied = await applyIntentRequestExecutionElement.process(
    executed,
    context,
  );
  return finalizeConversationElement.process(applied, context);
};
