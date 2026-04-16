import type { TaskItem } from "@/types/task";
import type { ServiceManager } from "@/libs/service-manage";
import { buildInternalTaskItem } from "@/libs";
import {
  ChatEvents,
  type ChatChunkAppendedEventPayload,
  type ChatFailedEventPayload,
  type ChatCompletedEventPayload,
} from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { TaskSource, TaskState, type FollowUpIntentRequest } from "@/types";

import { isEmpty, isNumber, sleep } from "radashi";
import { TaskQueue } from "./queue";
import { Runtime } from "./runtime";
import { Transport } from "./transport";

export class Core {
  static readonly ACTIVATE_TASK_DELAY = 1000;
  static readonly FOLLOW_UP_OUTPUT_PREFIX = "[Contune] ";

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
   * 读取当前任务的内部续跑轮次。
   * @description
   * 外部任务不带 chain_round，因此默认从 0 开始，
   * 第一次派生 FOLLOW_UP 内部任务时再递增到 1。
   */
  #parseTaskChainRound(task: TaskItem) {
    const chainRound = (
      task as TaskItem & {
        chain_round?: number;
      }
    ).chain_round;

    if (!isNumber(chainRound) || chainRound < 1) {
      return 0;
    }

    return chainRound;
  }

  /**
   * 构造 FOLLOW_UP 内部任务。
   * @description
   * 内部任务只携带最小续跑提示，
   * 真实上下文由 Runtime Context 负责维护和注入。
   */
  #buildFollowUpTask(task: TaskItem, request: FollowUpIntentRequest) {
    const nextChainRound = this.#parseTaskChainRound(task) + 1;
    const followUpIntent = isEmpty(request.intent)
      ? "请基于当前 FollowUp 上下文继续当前回答，不要重复已经输出的内容。"
      : request.intent;

    return buildInternalTaskItem({
      sessionId: request.params.sessionId,
      chatId: request.params.chatId,
      chainId: task.chainId,
      parentId: task.id,
      chain_round: nextChainRound,
      priority: 1,
      eventTarget: task.eventTarget,
      channel: task.channel,
      payload: [
        {
          type: "text",
          data: followUpIntent,
        },
      ],
    });
  }

  /**
   * 执行任务流程
   */
  async #workflow() {
    const task = await this.#taskQueue.activateWorkableTask();

    if (!task) {
      this.runloop();
      return;
    }

    this.#activedTask = task;

    try {
      this.#runtime.currentTask = task;
      const [systemPrompt, userPrompt] = await this.#runtime.exportPrompts();
      let hasProcessingState = false;
      let hasFollowUpOutputPrefix = false;

      const result = await this.#transport.send(systemPrompt, userPrompt, {
        onTextDelta: (textDelta) => {
          // PROCESSING 只代表内部任务已经进入执行阶段。
          // 对外真正用于同步内容的事件是 CHAT_CHUNK_APPENDED，便于把状态推进和流式内容排查分开。
          if (!hasProcessingState) {
            this.#taskQueue.updateTask(task.id, {
              state: TaskState.PROCESSING,
            }, {
              shouldSyncEvent: false,
            });
            hasProcessingState = true;
          }

          // 内部 FOLLOW_UP 任务对外仍属于同一轮 chat，
          // 这里在首个可见 chunk 前补一个显式提示，避免用户误以为模型突然重复起话。
          const outputTextDelta =
            task.source === TaskSource.INTERNAL && !hasFollowUpOutputPrefix
              ? `${Core.FOLLOW_UP_OUTPUT_PREFIX}${textDelta}`
              : textDelta;

          if (task.source === TaskSource.INTERNAL && !hasFollowUpOutputPrefix) {
            hasFollowUpOutputPrefix = true;
          }

          this.#runtime.appendAssistantOutput(outputTextDelta);

          // 本次不额外引入 CHAT_STREAM_STARTED。
          // 第一条 chunk 到来就代表已经开始流式输出，外部可以据此判断执行阶段已经开始。
          const payload: ChatChunkAppendedEventPayload = {
            sessionId: task.sessionId,
            chatId: task.chatId,
            status: ChatStatus.PROCESSING,
            chunk: outputTextDelta,
          };

          task.eventTarget?.emit(ChatEvents.CHAT_CHUNK_APPENDED, payload);
        },
      });

      const requestResult = this.#runtime.parseLLMRequest(result.requestText);

      if (requestResult.followUpRequest) {
        // FOLLOW_UP 说明当前外部 chat 还没有结束。
        // 这里不能对外发送 completed，而是把当前任务收束为内部续跑链路。
        const followUpTask = this.#buildFollowUpTask(
          task,
          requestResult.followUpRequest,
        );

        this.#taskQueue.updateTask(
          task.id,
          { state: TaskState.FOLLOW_UP },
          { shouldSyncEvent: false },
        );
        await this.#taskQueue.addTask(followUpTask);
        return;
      }

      this.#taskQueue.updateTask(
        task.id,
        { state: TaskState.COMPLETE },
        { shouldSyncEvent: false },
      );

      const completedMessage = this.#runtime.getAccumulatedAssistantOutput();

      const payload: ChatCompletedEventPayload = {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: ChatStatus.COMPLETE,
        message: {
          createdAt: Date.now(),
          data: isEmpty(completedMessage) ? result.text : completedMessage,
        },
      };

      task.eventTarget?.emit(ChatEvents.CHAT_COMPLETED, payload);
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
      this.runloop();
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
   * 向内核添加任务,这个任务由buildTasl
   * @param task
   */
  async addTask(task: TaskItem) {
    await this.#taskQueue.addTask(task);
  }
}
