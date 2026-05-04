import type { TaskItem } from "@/types/task";
import type { ServiceManager } from "@/libs/service-manage";
import type { Logger } from "@/libs/log";
import { ChatEvents, type ChatFailedEventPayload } from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { TaskState } from "@/types";

import { sleep, toResult } from "radashi";
import { TaskQueue } from "./queue";
import { Runtime } from "./runtime";
import { PipelineRunner, type PipelineResult } from "./pipeline";
import { runPipeline } from "./pipeline/definitions";

type CoreOptions = {
  logger?: Logger;
  runtimeLogger?: Logger;
};

const resolveTaskStateFromPipelineResult = (
  result: PipelineResult,
): TaskState => {
  switch (result.type) {
    case "complete":
      return TaskState.COMPLETED;
    case "enqueue":
      switch (result.transition) {
        case "follow_up":
          return TaskState.FOLLOW_UP;
        case "dispatch":
          return TaskState.DISPATCHED;
        default: {
          const _exhaustive: never = result.transition;
          return _exhaustive;
        }
      }
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
};

export class Core {
  static readonly ACTIVATE_TASK_DELAY = 1000;

  #serviceManager: ServiceManager;
  #taskQueue: TaskQueue;
  #runtime: Runtime;
  #isRunning: boolean;
  #logger: Logger | undefined;

  #activedTask: TaskItem | undefined = undefined;
  #pipelineRunner = new PipelineRunner();

  constructor(serviceManager: ServiceManager, options: CoreOptions = {}) {
    this.#serviceManager = serviceManager;
    this.#taskQueue = new TaskQueue();
    this.#runtime = new Runtime(this.#serviceManager, {
      logger: options.runtimeLogger,
    });
    this.#isRunning = false;
    this.#logger = options.logger;
    this.#logger?.info("Core initialized");
  }

  /* ==================== */
  /*        Private       */
  /* ==================== */

  #handlePipelineError(task: TaskItem, error: unknown, pipeline: string) {
    this.#logger?.error("Pipeline failed", {
      error,
      data: {
        taskId: task.id,
        sessionId: task.sessionId,
        chatId: task.chatId,
        pipeline,
      },
    });

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
  }

  async #handlePipelineResult(result: PipelineResult | void) {
    if (!result) {
      return;
    }

    const state = resolveTaskStateFromPipelineResult(result);

    this.#taskQueue.updateTask(
      result.task.id,
      { state },
      { shouldSyncEvent: false },
    );

    if (result.type === "enqueue") {
      await this.#taskQueue.addTask(result.nextTask);
    }
  }

  async #runActivatedTask() {
    const task = await this.#taskQueue.activateWorkableTask();

    if (!task) {
      return;
    }

    this.#activedTask = task;

    try {
      const taskPipeline = task.pipeline;

      this.#logger?.debug("Task activated", {
        data: {
          taskId: task.id,
          sessionId: task.sessionId,
          chatId: task.chatId,
          pipeline: taskPipeline,
          followUpPolicy: task.followUpPolicy,
          chainRound: task.chainRound,
          parentTaskId: task.parentTaskId,
        },
      });

      const deps = {
        taskQueue: this.#taskQueue,
        runtime: this.#runtime,
        serviceManager: this.#serviceManager,
      };

      const [pipelineError, pipelineResult] = await toResult(
        runPipeline(taskPipeline, task, deps, this.#pipelineRunner),
      );

      if (pipelineError) {
        this.#handlePipelineError(task, pipelineError, taskPipeline);
        return;
      }

      await this.#handlePipelineResult(pipelineResult);
    } catch (error) {
      this.#handlePipelineError(
        task,
        error instanceof Error ? error : new Error(String(error)),
        "unknown",
      );
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
    this.#logger?.info("Core runloop started");

    try {
      while (true) {
        if (this.#taskQueue.isEmpty) {
          await sleep(500);
          continue;
        }

        await this.#runActivatedTask();
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

    await this.#runActivatedTask();
  }

  /**
   * 向内核添加任务,这个任务由buildTasl
   * @param task
   */
  async addTask(task: TaskItem) {
    await this.#taskQueue.addTask(task);
  }
}
