import type { TaskItem } from "@/types/queue";
import type { ServiceManager } from "@/libs/service-manage";
import {
  APIEvents,
  ChatStatus,
  type ChatFailedEventPayload,
  type ChatFinishedEventPayload,
  type ChatUpdatedEventPayload,
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
          if (!hasProcessingState) {
            this.#taskQueue.updateTask(task.id, {
              state: TaskState.PROCESSING,
            });
            hasProcessingState = true;
          }

          const payload: ChatUpdatedEventPayload = {
            sessionId: task.sessionId,
            chatId: task.chatId,
            status: ChatStatus.PROCESSING,
            chunk: textDelta,
          };

          task.eventTarget?.emit(APIEvents.CHAT_UPDATED, payload);
        },
      });

      this.#runtime.parseLLMRequest(result.requestText);
      this.#taskQueue.updateTask(task.id, { state: TaskState.COMPLETE });

      const payload: ChatFinishedEventPayload = {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: ChatStatus.COMPLETE,
        message: {
          createdAt: Date.now(),
          data: result.text,
        },
      };

      task.eventTarget?.emit(APIEvents.CHAT_FINISHED, payload);
    } catch (error) {
      this.#taskQueue.updateTask(task.id, { state: TaskState.FAILED });

      const payload: ChatFailedEventPayload = {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: ChatStatus.FAILED,
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };

      task.eventTarget?.emit(APIEvents.CHAT_FAILED, payload);
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
