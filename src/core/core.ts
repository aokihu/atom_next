import type { TaskItem } from "@/types/task";
import type { ServiceManager } from "@/libs/service-manage";
import {
  ChatEvents,
  type ChatChunkAppendedEventPayload,
  type ChatFailedEventPayload,
} from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { TaskState } from "@/types";

import { sleep } from "radashi";
import { TaskQueue } from "./queue";
import { Runtime } from "./runtime";
import { Transport } from "./transport";

export class Core {
  static readonly ACTIVATE_TASK_DELAY = 1000;

  #serviceManager: ServiceManager;
  #taskQueue: TaskQueue;
  #runtime: Runtime;
  #transport: Transport;

  #activedTask: TaskItem | undefined = undefined; // 当前激活的任务
  #activeTimer: NodeJS.Timeout | null = null; // 定时检查激活任务计时器

  constructor(serviceManager: ServiceManager) {
    this.#serviceManager = serviceManager;
    this.#taskQueue = new TaskQueue();
    this.#runtime = new Runtime(this.#serviceManager);
    this.#transport = new Transport(this.#serviceManager);
  }

  /* ==================== */
  /*        Private       */
  /* ==================== */

  /**
   * 空任务循环
   * @description 当队列中没有任何任务的时候执行该循环
   */
  async #emptyRunloop() {
    await sleep(500);
    this.runloop();
  }

  /**
   * 推进任务到 PROCESSING 状态。
   * @description
   * 这里只负责第一次进入流式阶段时推进内部状态，
   * 不额外发出队列生命周期事件，避免和 chunk 事件职责重叠。
   * @param task 当前正在执行的任务
   * @param hasSyncedProcessingState 标记当前任务是否已经同步过一次 PROCESSING 状态。
   *                                 onTextDelta 会被连续调用，因此这里用这个布尔值
   *                                 避免在每个 chunk 到来时重复更新同一个状态。
   * @returns 返回最新的 PROCESSING 状态标记，调用方用它继续维护热路径中的局部状态。
   */
  #syncTaskProcessingState(task: TaskItem, hasSyncedProcessingState: boolean) {
    if (hasSyncedProcessingState) {
      return true;
    }

    this.#taskQueue.updateTask(
      task.id,
      {
        state: TaskState.PROCESSING,
      },
      {
        shouldSyncEvent: false,
      },
    );

    return true;
  }

  /**
   * 发送流式 chunk 事件。
   * @description
   * 第一条 chunk 到来就代表已经进入流式输出阶段，
   * 外部通过 CHAT_CHUNK_APPENDED 即可同步当前可见内容。
   */
  #emitChatChunkAppendedEvent(task: TaskItem, textDelta: string) {
    const payload: ChatChunkAppendedEventPayload = {
      sessionId: task.sessionId,
      chatId: task.chatId,
      status: ChatStatus.PROCESSING,
      chunk: textDelta,
    };

    task.eventTarget?.emit(ChatEvents.CHAT_CHUNK_APPENDED, payload);
  }

  /**
   * 执行当前用户输入的预处理流程。
   * @description
   * Step 1 中，core.ts 保留为函数式编排层：
   * 这里只负责串起 Runtime 的统一预处理入口，
   * 不再直接持有 prediction / policy / preload 的细节实现。
   */
  async #prepareUserInputFlow(task: TaskItem) {
    await this.#runtime.prepareExecutionContext(task, this.#transport);
  }

  /**
   * 应用单条 Intent Request 的处理结果。
   * @description
   * 这里统一负责把 handler 的结果映射到任务状态和队列变更，
   * 避免在主流程里散落多个 updateTask / addTask 分支。
   */
  async #applyIntentRequestProcessResult(task: TaskItem, result: Awaited<ReturnType<Runtime["executeIntentRequests"]>>) {
    if (result.status === "continue") {
      return false;
    }

    if (result.nextState) {
      this.#taskQueue.updateTask(
        task.id,
        { state: result.nextState },
        { shouldSyncEvent: false },
      );
    }

    if (result.nextTask) {
      await this.#taskQueue.addTask(result.nextTask);
    }

    return true;
  }

  /**
   * 执行任务流程
   * @description
   * 这里串起一次完整的任务执行链路：
   * 1. 激活队列中的可执行任务
   * 2. 导出 Runtime 生成的 system/user prompt
   * 3. 处理流式输出，并把可见文本持续同步回 Runtime 和外部事件
   * 4. 解析 intentRequestText，必要时派生 FOLLOW_UP 内部任务
   * 5. 在完成或失败时收束最终事件
   */
  async #workflow(shouldContinueRunloop = true) {
    const task = await this.#taskQueue.activateWorkableTask();

    if (!task) {
      if (shouldContinueRunloop) {
        this.runloop();
      }
      return;
    }

    this.#activedTask = task;

    try {
      this.#runtime.currentTask = task;
      await this.#prepareUserInputFlow(task);
      const [systemPrompt, userPrompt] = await this.#runtime.exportPrompts();
      let hasSyncedProcessingState = false;
      let visibleTextBuffer = "";

      const result = await this.#transport.send(systemPrompt, userPrompt, {
        onTextDelta: (textDelta) => {
          // onTextDelta 只负责热路径串联：
          // 先推进内部执行态，
          // 最后同步到 Runtime 累计输出和外部流式事件。
          hasSyncedProcessingState = this.#syncTaskProcessingState(
            task,
            hasSyncedProcessingState,
          );
          this.#runtime.appendAssistantOutput(textDelta);
          visibleTextBuffer += textDelta;
        },
      });

      // intentRequestText 只承载 LLM 在隐藏请求区输出的指令文本，
      // 这里统一交给 Runtime 做识别和安全校验，Core 只消费最终结果。
      const intentRequestResult = this.#runtime.parseLLMRequest(
        result.intentRequestText,
      );

      const requestExecutionResult = await this.#runtime.executeIntentRequests(
        task,
        intentRequestResult.safeRequests,
      );
      const shouldStopCompletion = await this.#applyIntentRequestProcessResult(
        task,
        requestExecutionResult,
      );

      if (shouldStopCompletion) {
        return;
      }

      const finalizationResult = this.#runtime.finalizeChatTurn(task, {
        resultText: result.text,
        visibleTextBuffer,
      });

      if (finalizationResult.visibleChunk) {
        this.#emitChatChunkAppendedEvent(task, finalizationResult.visibleChunk);
      }

      this.#taskQueue.updateTask(
        task.id,
        { state: TaskState.COMPLETE },
        { shouldSyncEvent: false },
      );
      task.eventTarget?.emit(
        ChatEvents.CHAT_COMPLETED,
        finalizationResult.completedPayload,
      );
    } catch (error) {
      this.#taskQueue.updateTask(
        task.id,
        { state: TaskState.FAILED },
        { shouldSyncEvent: false },
      );

      const payload: ChatFailedEventPayload = {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: ChatStatus.FAILED,
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };

      task.eventTarget?.emit(ChatEvents.CHAT_FAILED, payload);
    } finally {
      this.#activedTask = undefined;
      if (shouldContinueRunloop) {
        this.runloop();
      }
    }
  }

  /* ==================== */
  /*   Public Methods     */
  /* ==================== */

  async runloop() {
    if (this.#taskQueue.isEmpty) {
      this.#emptyRunloop();
    } else {
      this.#workflow();
    }
  }

  /**
   * 只执行一轮任务流程。
   * @description
   * 测试和受控调用场景下使用，避免自动进入持续 runloop。
   */
  async runOnce() {
    if (this.#taskQueue.isEmpty) {
      return;
    }

    await this.#workflow(false);
  }

  /**
   * 向内核添加任务,这个任务由buildTasl
   * @param task
   */
  async addTask(task: TaskItem) {
    await this.#taskQueue.addTask(task);
  }
}
