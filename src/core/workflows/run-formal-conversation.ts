import type { TaskItem } from "@/types/task";
import { ChatEvents, type ChatOutputUpdatedEventPayload } from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { TaskState } from "@/types";
import { promiseChain } from "radashi";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";
import type { Transport } from "../transport";

/* ==================== */
/* Workflow Types       */
/* ==================== */

type FormalConversationWorkflowDecision =
  | { type: "finalize_chat" }
  | { type: "defer_completion" };

type FormalConversationWorkflowEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
  transport: Transport;
};

type FormalConversationPrompts = {
  env: FormalConversationWorkflowEnv;
  systemPrompt: string;
  userPrompt: string;
};

type FormalConversationTransportOutput = {
  env: FormalConversationWorkflowEnv;
  transportResult: Awaited<ReturnType<Transport["send"]>>;
  visibleTextBuffer: string;
};

type ParsedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: Awaited<ReturnType<Transport["send"]>>;
  visibleTextBuffer: string;
  intentRequestResult: ReturnType<Runtime["parseIntentRequest"]>;
};

type ExecutedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: Awaited<ReturnType<Transport["send"]>>;
  visibleTextBuffer: string;
  requestExecutionResult: Awaited<
    ReturnType<Runtime["executeIntentRequests"]>
  >;
};

type AppliedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: Awaited<ReturnType<Transport["send"]>>;
  visibleTextBuffer: string;
  decision: FormalConversationWorkflowDecision;
};

export type RunFormalConversationWorkflowResult = {
  decision: FormalConversationWorkflowDecision;
};

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
/* Workflow Helpers     */
/* ==================== */

/**
 * 发出供轮询消费的输出增量事件。
 * @description
 * 这里维持当前产品语义：对外暴露的是“输出更新”，
 * 而不是 token 级实时流式事件。
 */
function emitChatOutputUpdatedEvent(task: TaskItem, delta: string): void {
  const payload: ChatOutputUpdatedEventPayload = {
    sessionId: task.sessionId,
    chatId: task.chatId,
    status: ChatStatus.PROCESSING,
    delta,
  };

  task.eventTarget?.emit(ChatEvents.CHAT_OUTPUT_UPDATED, payload);
}

/* ==================== */
/* Workflow Steps       */
/* ==================== */

/**
 * 将当前 task 同步到 runtime。
 * @description
 * formal conversation 的后续 prompt 生成、intent request 解析和结果收束
 * 都依赖 runtime.currentTask 已经指向当前 task。
 */
async function syncRuntimeTask(
  env: FormalConversationWorkflowEnv,
): Promise<FormalConversationWorkflowEnv> {
  env.runtime.currentTask = env.task;
  return env;
}

/**
 * 导出本轮正式对话所需的 prompts。
 * @description
 * 这里把 system/user prompt 作为显式 step 结果向下游传递，
 * 不再挂到共享 context 上。
 */
async function exportPrompts(
  env: FormalConversationWorkflowEnv,
): Promise<FormalConversationPrompts> {
  const [systemPrompt, userPrompt] = await env.runtime.exportPrompts();

  return {
    env,
    systemPrompt,
    userPrompt,
  };
}

/**
 * 执行正式对话请求，并累计本轮可见输出。
 * @description
 * 这里局部维护两类运行期状态：
 * - `hasSyncedProcessingState`：保证 PROCESSING 状态只推进一次
 * - `visibleTextBuffer`：累计本轮可见输出，供结束阶段统一对外发 output update
 *
 * 这两者都只属于当前 step 的执行过程，不进入 workflow env。
 */
async function sendConversation(
  input: FormalConversationPrompts,
): Promise<FormalConversationTransportOutput> {
  let hasSyncedProcessingState = false;
  let visibleTextBuffer = "";

  const transportResult = await input.env.transport.send(
    input.systemPrompt,
    input.userPrompt,
    {
      onTextDelta: (textDelta) => {
        if (!hasSyncedProcessingState) {
          input.env.taskQueue.updateTask(
            input.env.task.id,
            { state: TaskState.PROCESSING },
            { shouldSyncEvent: false },
          );
          hasSyncedProcessingState = true;
        }

        input.env.runtime.appendAssistantOutput(textDelta);
        visibleTextBuffer += textDelta;
      },
    },
  );

  return {
    env: input.env,
    transportResult,
    visibleTextBuffer,
  };
}

/**
 * 解析模型返回的 Intent Request 文本。
 * @description
 * 这一步只负责把 transport 的 request 文本转换成 runtime 可消费的结构结果，
 * 不在这里执行 request。
 */
async function parseIntentRequests(
  input: FormalConversationTransportOutput,
): Promise<ParsedIntentRequests> {
  return {
    env: input.env,
    transportResult: input.transportResult,
    visibleTextBuffer: input.visibleTextBuffer,
    intentRequestResult: input.env.runtime.parseIntentRequest(
      input.transportResult.intentRequestText,
    ),
  };
}

/**
 * 执行安全通过的 Intent Requests。
 * @description
 * runtime 负责把 request 执行映射到 memory / follow-up 相关结果，
 * workflow 只负责继续向后传递执行结果。
 */
async function executeIntentRequests(
  input: ParsedIntentRequests,
): Promise<ExecutedIntentRequests> {
  return {
    env: input.env,
    transportResult: input.transportResult,
    visibleTextBuffer: input.visibleTextBuffer,
    requestExecutionResult: await input.env.runtime.executeIntentRequests(
      input.env.task,
      input.intentRequestResult.safeRequests,
    ),
  };
}

/**
 * 将 Intent Request 执行结果应用到 queue。
 * @description
 * 这一步只负责根据执行结果：
 * - 决定是 finalize 还是 defer
 * - 推进 nextState
 * - 派生 nextTask
 *
 * decision 作为显式结果返回给最终收束 step。
 */
async function applyIntentRequestExecution(
  input: ExecutedIntentRequests,
): Promise<AppliedIntentRequests> {
  if (input.requestExecutionResult.status === "continue") {
    return {
      env: input.env,
      transportResult: input.transportResult,
      visibleTextBuffer: input.visibleTextBuffer,
      decision: { type: "finalize_chat" },
    };
  }

  if (input.requestExecutionResult.nextState) {
    input.env.taskQueue.updateTask(
      input.env.task.id,
      { state: input.requestExecutionResult.nextState },
      { shouldSyncEvent: false },
    );
  }

  if (input.requestExecutionResult.nextTask) {
    await input.env.taskQueue.addTask(input.requestExecutionResult.nextTask);
  }

  return {
    env: input.env,
    transportResult: input.transportResult,
    visibleTextBuffer: input.visibleTextBuffer,
    decision: { type: "defer_completion" },
  };
}

/**
 * 收束当前正式对话轮次。
 * @description
 * - defer 时只返回 decision，不发完成事件
 * - finalize 时：
 *   1. 让 runtime 生成最终完成结果
 *   2. 发 output update 事件
 *   3. 推进 COMPLETE 状态
 *   4. 发 CHAT_COMPLETED
 */
async function finalizeConversation(
  input: AppliedIntentRequests,
): Promise<RunFormalConversationWorkflowResult> {
  if (input.decision.type === "defer_completion") {
    return {
      decision: input.decision,
    };
  }

  const finalizationResult = input.env.runtime.finalizeChatTurn(input.env.task, {
    resultText: input.transportResult.text,
    visibleTextBuffer: input.visibleTextBuffer,
  });

  if (finalizationResult.visibleChunk) {
    emitChatOutputUpdatedEvent(input.env.task, finalizationResult.visibleChunk);
  }

  input.env.taskQueue.updateTask(
    input.env.task.id,
    { state: TaskState.COMPLETE },
    { shouldSyncEvent: false },
  );

  input.env.task.eventTarget?.emit(
    ChatEvents.CHAT_COMPLETED,
    finalizationResult.completedPayload,
  );

  return {
    decision: input.decision,
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
) => {
  /**
   * 保留 promiseChain 的原因：
   * - step 顺序清晰
   * - 异常统一向上冒泡
   * - 错误处理继续集中在 workflow 外部收口
   */
  return promiseChain(
    syncRuntimeTask,
    exportPrompts,
    sendConversation,
    parseIntentRequests,
    executeIntentRequests,
    applyIntentRequestExecution,
    finalizeConversation,
  )(
    createFormalConversationWorkflowEnv(
      task,
      taskQueue,
      runtime,
      transport,
    ),
  );
};
