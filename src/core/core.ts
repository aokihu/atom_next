import type { TaskItem } from "@/types/task";
import type { ServiceManager } from "@/libs/service-manage";
import {
  ChatEvents,
  type ChatFailedEventPayload,
} from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { TaskState } from "@/types";
import { TaskSource, TaskWorkflow } from "@/types/task";

import { sleep, toResult } from "radashi";
import { TaskQueue } from "./queue";
import { Runtime } from "./runtime";
import { Transport } from "./transport";
import {
  runFormalConversationWorkflow,
  runUserIntentPredictionWorkflow,
} from "./workflows";

export class Core {
  static readonly ACTIVATE_TASK_DELAY = 1000;

  #serviceManager: ServiceManager;
  #taskQueue: TaskQueue;
  #runtime: Runtime;
  #transport: Transport;
  #isRunning: boolean;

  #activedTask: TaskItem | undefined = undefined; // 当前激活的任务
  #activeTimer: NodeJS.Timeout | null = null; // 定时检查激活任务计时器

  constructor(serviceManager: ServiceManager) {
    this.#serviceManager = serviceManager;
    this.#taskQueue = new TaskQueue();
    this.#runtime = new Runtime(this.#serviceManager);
    this.#transport = new Transport(this.#serviceManager);
    this.#isRunning = false;
  }

  /* ==================== */
  /*        Private       */
  /* ==================== */

  #parseTaskWorkflow(task: TaskItem) {
    return task.workflow ??
      (task.source === TaskSource.EXTERNAL
        ? TaskWorkflow.PREDICT_USER_INTENT
        : TaskWorkflow.FORMAL_CONVERSATION);
  }

  /**
   * 执行任务流程
   * @description
   * 这里串起一次完整的任务执行链路：
   * 1. 激活队列中的可执行任务
   * 2. 导出 Runtime 生成的 system/user prompt
   * 3. 处理模型输出，并把本轮可见文本累计到 Runtime
   * 4. 解析 intentRequestText，必要时派生 FOLLOW_UP 内部任务
   * 5. 在完成或失败时收束最终事件
   */
  async #workflow() {
    const task = await this.#taskQueue.activateWorkableTask();

    if (!task) {
      return;
    }

    this.#activedTask = task;

    try {
      const taskWorkflow = this.#parseTaskWorkflow(task);

      if (taskWorkflow === TaskWorkflow.PREDICT_USER_INTENT) {
        const [workflowError] = await toResult(
          runUserIntentPredictionWorkflow(
            task,
            this.#taskQueue,
            this.#runtime,
            this.#transport,
          ),
        );

        if (workflowError) {
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
              message:
                workflowError instanceof Error
                  ? workflowError.message
                  : "Unknown error",
            },
          };

          task.eventTarget?.emit(ChatEvents.CHAT_FAILED, payload);
        }

        return;
      }

      const [workflowError, workflowResult] = await toResult(
        runFormalConversationWorkflow(
          task,
          this.#taskQueue,
          this.#runtime,
          this.#transport,
        ),
      );

      if (workflowError) {
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
            message:
              workflowError instanceof Error
                ? workflowError.message
                : "Unknown error",
          },
        };

        task.eventTarget?.emit(ChatEvents.CHAT_FAILED, payload);
        return;
      }

      if (workflowResult?.decision.type === "defer_completion") {
        return;
      }
    } finally {
      this.#activedTask = undefined;
    }
  }

  /* ==================== */
  /*   Public Methods     */
  /* ==================== */

  async runloop() {
    if (this.#isRunning) {
      return;
    }

    this.#isRunning = true;

    try {
      while (true) {
        if (this.#taskQueue.isEmpty) {
          await sleep(500);
          continue;
        }

        await this.#workflow();
      }
    } finally {
      this.#isRunning = false;
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

    await this.#workflow();
  }

  /**
   * 向内核添加任务,这个任务由buildTasl
   * @param task
   */
  async addTask(task: TaskItem) {
    await this.#taskQueue.addTask(task);
  }
}
