import type { TaskItem } from "@/types/task";
import type { ServiceManager } from "@/libs/service-manage";
import type { Logger } from "@/libs/log";
import { ChatEvents, type ChatFailedEventPayload } from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { TaskState } from "@/types";
import { TaskSource, TaskWorkflow } from "@/types/task";

import { sleep, toResult } from "radashi";
import { TaskQueue } from "./queue";
import { Runtime } from "./runtime";
import { PipelineEventBus, PipelineRunner, type PipelineResult } from "./pipeline";
import type { PipelineEventMap } from "./pipeline";
import { PipelineRegistry } from "./pipeline/definitions";

type CoreOptions = {
  logger?: Logger;
  runtimeLogger?: Logger;
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

  #parseTaskPipeline(task: TaskItem): TaskWorkflow {
    if (task.pipeline) return task.pipeline;
    if (task.workflow) return task.workflow;
    if (task.source === TaskSource.EXTERNAL)
      return TaskWorkflow.PREDICT_USER_INTENT;
    if (task.source === TaskSource.INTERNAL)
      return TaskWorkflow.FORMAL_CONVERSATION;
    throw new Error(
      `Cannot determine pipeline for task ${task.id}: unknown source ${task.source}`,
    );
  }

  #pickPipelineDefinition(pipeline: TaskWorkflow) {
    return PipelineRegistry.get(pipeline);
  }

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

    if (result.type === "enqueue") {
      await this.#taskQueue.addTask(result.nextTask);
      return;
    }

    if (result.type === "complete") {
      return;
    }

    const _exhaustive: never = result;
    return _exhaustive;
  }

  async #runActivatedTask() {
    const task = await this.#taskQueue.activateWorkableTask();

    if (!task) {
      return;
    }

    this.#activedTask = task;

    try {
      const taskPipeline = this.#parseTaskPipeline(task);
      const pipelineDefinition = this.#pickPipelineDefinition(taskPipeline);

      if (!pipelineDefinition) {
        throw new Error(`Unknown pipeline: ${taskPipeline}`);
      }

      this.#logger?.debug("Task activated", {
        data: {
          taskId: task.id,
          sessionId: task.sessionId,
          chatId: task.chatId,
          pipeline: taskPipeline,
        },
      });

      const deps = {
        taskQueue: this.#taskQueue,
        runtime: this.#runtime,
        serviceManager: this.#serviceManager,
      };

      const eventBus = new PipelineEventBus<PipelineEventMap>();
      const input = pipelineDefinition.createInput(task, deps);
      const pipeline = pipelineDefinition.createPipeline(deps);
      const cleanup = pipelineDefinition.setup?.(eventBus, input, deps);

      const [pipelineError, pipelineResult] = await toResult(
        this.#pipelineRunner.run(pipeline, input, {
          task,
          eventBus,
        }),
      );

      try {
        if (pipelineError) {
          this.#handlePipelineError(task, pipelineError, taskPipeline);
          return;
        }

        await this.#handlePipelineResult(pipelineResult);
      } finally {
        cleanup?.();
      }
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
