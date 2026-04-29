import type { TaskItem } from "@/types/task";
import { ChatEvents, type ChatOutputUpdatedEventPayload } from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { TaskState } from "@/types";
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
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
};

type ParsedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: Awaited<ReturnType<Transport["send"]>>;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
  intentRequestResult: ReturnType<Runtime["parseIntentRequest"]>;
};

type ExecutedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: Awaited<ReturnType<Transport["send"]>>;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
  requestExecutionResult: Awaited<
    ReturnType<Runtime["executeIntentRequests"]>
  >;
};

type AppliedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: Awaited<ReturnType<Transport["send"]>>;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  decision: FormalConversationWorkflowDecision;
};

type ToolBoundaryResolution =
  | FormalConversationTransportOutput
  | AppliedIntentRequests;

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

const shouldFinalizeToolCallBoundary = (
  input: ExecutedIntentRequests,
) => {
  return (
    input.transportResult.finishReason === "tool-calls"
    && input.transportResult.intentRequestText.trim() === ""
    && input.requestExecutionResult.status === "continue"
  );
};

const getToolFailureMessage = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const errorValue = (value as Record<string, unknown>).error;
  return typeof errorValue === "string" && errorValue.trim() !== ""
    ? errorValue.trim()
    : undefined;
};

const stringifyToolError = (value: unknown) => {
  if (value instanceof Error) {
    return value.message;
  }

  return String(value);
};

const buildToolFailureVisibleMessage = (messages: string[]) => {
  const [firstMessage] = messages;
  return firstMessage
    ? `工具调用失败，暂时无法继续分析当前工作区。错误：${firstMessage}`
    : "工具调用失败，暂时无法继续分析当前工作区。";
};

const buildToolBoundaryVisibleMessage = (input: ExecutedIntentRequests) => {
  if (input.toolFailureMessages.length > 0) {
    return buildToolFailureVisibleMessage(input.toolFailureMessages);
  }

  if (input.transportResult.toolCallCount === 0) {
    return "模型进入了工具调用阶段，但没有实际执行任何工具。请调整问题范围，或让我先检查更具体的文件或目录。";
  }

  if (input.transportResult.toolResultCount === 0) {
    return "工具调用已开始，但没有返回可用结果，当前分析已停止。请调整问题范围，或让我先检查更具体的文件或目录。";
  }

  return "工具调用已完成，但在当前多步调用内仍未形成最终结果。请缩小分析范围，或指定更具体的文件或目录。";
};

const buildToolLoopTerminationResult = (
  input: ExecutedIntentRequests,
): AppliedIntentRequests => {
  const visibleTextBuffer = buildToolBoundaryVisibleMessage(input);

  return {
    env: input.env,
    transportResult: {
      ...input.transportResult,
      text: visibleTextBuffer,
    },
    visibleTextBuffer,
    hasStreamedVisibleOutput: false,
    decision: { type: "finalize_chat" },
  };
};

const shouldExecutePendingToolCalls = (
  input: FormalConversationTransportOutput,
) => {
  return (
    input.transportResult.finishReason === "tool-calls"
    && (input.transportResult.pendingToolCalls?.length ?? 0) > 0
  );
};

const buildToolExecutionFailureResult = (
  input: FormalConversationTransportOutput,
  reason: string,
): AppliedIntentRequests => {
  const visibleTextBuffer = reason.trim() === ""
    ? "工具调用失败，暂时无法继续分析当前工作区。"
    : `工具调用失败，暂时无法继续分析当前工作区。错误：${reason}`;

  return {
    env: input.env,
    transportResult: {
      ...input.transportResult,
      text: visibleTextBuffer,
    },
    visibleTextBuffer,
    hasStreamedVisibleOutput: false,
    decision: { type: "finalize_chat" },
  };
};

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
  let hasStreamedVisibleOutput = false;
  let visibleTextBuffer = "";
  let toolCallStartCount = 0;
  let toolCallFinishCount = 0;
  const toolFailureMessages: string[] = [];
  const tools = input.env.runtime.createConversationToolRegistry();

  const transportResult = await input.env.transport.send(
    input.systemPrompt,
    input.userPrompt,
    {
      maxOutputTokens: input.env.runtime.getFormalConversationMaxOutputTokens(),
      maxToolSteps: input.env.runtime.getFormalConversationMaxToolSteps(),
      tools,
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
        emitChatOutputUpdatedEvent(input.env.task, textDelta);
        hasStreamedVisibleOutput = true;
        visibleTextBuffer += textDelta;
      },
      onToolCallStart: (event) => {
        toolCallStartCount += 1;
        input.env.runtime.reportToolCallStarted(event);
      },
      onToolCallFinish: (event) => {
        toolCallFinishCount += 1;

        if ("error" in event && event.error) {
          toolFailureMessages.push(stringifyToolError(event.error));
        } else {
          const failureMessage = getToolFailureMessage(event.result);

          if (failureMessage) {
            toolFailureMessages.push(failureMessage);
          }
        }

        input.env.runtime.reportToolCallFinished(event);
      },
    },
  );

  input.env.runtime.clearContinuationContext();

  return {
    env: input.env,
    transportResult,
    visibleTextBuffer,
    hasStreamedVisibleOutput,
    toolCallStartCount,
    toolCallFinishCount,
    toolFailureMessages,
  };
}

async function handleToolBoundary(
  input: FormalConversationTransportOutput,
): Promise<ToolBoundaryResolution> {
  if (!shouldExecutePendingToolCalls(input)) {
    return input;
  }

  const toolExecutionResult = await input.env.runtime.executeConversationToolCalls(
    input.transportResult.pendingToolCalls ?? [],
  );

  if (!toolExecutionResult.ok) {
    return buildToolExecutionFailureResult(input, toolExecutionResult.reason);
  }

  input.env.taskQueue.updateTask(
    input.env.task.id,
    { state: TaskState.FOLLOW_UP },
    { shouldSyncEvent: false },
  );
  await input.env.taskQueue.addTask(
    input.env.runtime.createContinuationFormalConversationTask(input.env.task),
  );

  return {
    env: input.env,
    transportResult: input.transportResult,
    visibleTextBuffer: input.visibleTextBuffer,
    hasStreamedVisibleOutput: input.hasStreamedVisibleOutput,
    decision: { type: "defer_completion" },
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
  input.env.runtime.reportConversationOutputAnalysis({
    finishReason: String(input.transportResult.finishReason),
    visibleTextCharLength: input.visibleTextBuffer.length,
    intentRequestText: input.transportResult.intentRequestText,
    stepCount: input.transportResult.stepCount,
    toolCallCount: input.transportResult.toolCallCount,
    toolResultCount: input.transportResult.toolResultCount,
    responseMessageCount: input.transportResult.responseMessageCount,
  });

  return {
    env: input.env,
    transportResult: input.transportResult,
    visibleTextBuffer: input.visibleTextBuffer,
    hasStreamedVisibleOutput: input.hasStreamedVisibleOutput,
    toolCallStartCount: input.toolCallStartCount,
    toolCallFinishCount: input.toolCallFinishCount,
    toolFailureMessages: input.toolFailureMessages,
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
    hasStreamedVisibleOutput: input.hasStreamedVisibleOutput,
    toolCallStartCount: input.toolCallStartCount,
    toolCallFinishCount: input.toolCallFinishCount,
    toolFailureMessages: input.toolFailureMessages,
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
  if (shouldFinalizeToolCallBoundary(input)) {
    return buildToolLoopTerminationResult(input);
  }

  if (input.requestExecutionResult.status === "continue") {
    return {
      env: input.env,
      transportResult: input.transportResult,
      visibleTextBuffer: input.visibleTextBuffer,
      hasStreamedVisibleOutput: input.hasStreamedVisibleOutput,
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
    hasStreamedVisibleOutput: input.hasStreamedVisibleOutput,
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
 *   3. 推进 COMPLETED 状态
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

  if (!input.hasStreamedVisibleOutput && finalizationResult.visibleChunk) {
    emitChatOutputUpdatedEvent(input.env.task, finalizationResult.visibleChunk);
  }

  input.env.taskQueue.updateTask(
    input.env.task.id,
    { state: TaskState.COMPLETED },
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
  const env = await syncRuntimeTask(
    createFormalConversationWorkflowEnv(task, taskQueue, runtime, transport),
  );
  const prompts = await exportPrompts(env);
  const transportOutput = await sendConversation(prompts);
  const toolBoundaryResult = await handleToolBoundary(transportOutput);

  if ("decision" in toolBoundaryResult) {
    return finalizeConversation(toolBoundaryResult);
  }

  const parsed = await parseIntentRequests(toolBoundaryResult);
  const executed = await executeIntentRequests(parsed);
  const applied = await applyIntentRequestExecution(executed);
  return finalizeConversation(applied);
};
