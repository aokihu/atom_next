import type { TaskItem } from "@/types/queue";
import type { ServiceManager } from "@/libs/service-manage";
import {
  ChatEvents,
  ChatStatus,
  type ChatChunkAppendedEventPayload,
  type ChatFailedEventPayload,
  type ChatCompletedEventPayload,
} from "@/types/api";
import { TaskState } from "@/types/queue";

import { sleep } from "radashi";
import { TaskQueue } from "../queue";
import { Runtime } from "../runtime";
import { Transport } from "../transport";

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
    this.#runtime = new Runtime();
    this.#transport = new Transport();
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
      const [systemPrompt, userPrompt] = this.#runtime.exportPrompts();
      let hasProcessingState = false;

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

          // 本次不额外引入 CHAT_STREAM_STARTED。
          // 第一条 chunk 到来就代表已经开始流式输出，外部可以据此判断执行阶段已经开始。
          const payload: ChatChunkAppendedEventPayload = {
            sessionId: task.sessionId,
            chatId: task.chatId,
            status: ChatStatus.PROCESSING,
            chunk: textDelta,
          };

          task.eventTarget?.emit(ChatEvents.CHAT_CHUNK_APPENDED, payload);
        },
      });

      this.#runtime.parseLLMRequest(result.requestText);
      this.#taskQueue.updateTask(
        task.id,
        { state: TaskState.COMPLETE },
        { shouldSyncEvent: false },
      );

      const payload: ChatCompletedEventPayload = {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: ChatStatus.COMPLETE,
        message: {
          createdAt: Date.now(),
          data: result.text,
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
