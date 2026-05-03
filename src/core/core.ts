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
import type { PipelineResult } from "./pipeline";
import {
  runFormalConversationWorkflow,
  runPostFollowUpWorkflow,
  runUserIntentPredictionWorkflow,
} from "./workflows";

type CoreOptions = {
  logger?: Logger;
  runtimeLogger?: Logger;
};

type WorkflowRunnerResult = { decision?: { type: string } };
type WorkflowRunResult = PipelineResult | WorkflowRunnerResult | void;
type WorkflowRunner = (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  serviceManager: ServiceManager,
) => Promise<WorkflowRunResult>;

const WorkflowRunners = new Map<TaskWorkflow, WorkflowRunner>([
  [TaskWorkflow.PREDICT_USER_INTENT, runUserIntentPredictionWorkflow],
  [TaskWorkflow.POST_FOLLOW_UP, runPostFollowUpWorkflow],
  [TaskWorkflow.FORMAL_CONVERSATION, runFormalConversationWorkflow],
]);

const isLegacyWorkflowRunnerResult = (
  value: WorkflowRunResult,
): value is WorkflowRunnerResult => {
  return typeof value === "object" && value !== null && "decision" in value;
};

const isPipelineResult = (
  value: WorkflowRunResult,
): value is PipelineResult => {
  return typeof value === "object" && value !== null && "type" in value;
};

export class Core {
  static readonly ACTIVATE_TASK_DELAY = 1000;

  #serviceManager: ServiceManager;
  #taskQueue: TaskQueue;
  #runtime: Runtime;
  #isRunning: boolean;
  #logger: Logger | undefined;

  #activedTask: TaskItem | undefined = undefined;

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

  #parseTaskWorkflow(task: TaskItem): TaskWorkflow {
    if (task.workflow) return task.workflow;
    if (task.source === TaskSource.EXTERNAL)
      return TaskWorkflow.PREDICT_USER_INTENT;
    if (task.source === TaskSource.INTERNAL)
      return TaskWorkflow.FORMAL_CONVERSATION;
    throw new Error(
      `Cannot determine workflow for task ${task.id}: unknown source ${task.source}`,
    );
  }

  #pickWorkflowRunner(workflow: TaskWorkflow): WorkflowRunner | undefined {
    return WorkflowRunners.get(workflow);
  }

  #handleWorkflowError(task: TaskItem, error: unknown, workflow: string) {
    this.#logger?.error("Workflow failed", {
      error,
      data: {
        taskId: task.id,
        sessionId: task.sessionId,
        chatId: task.chatId,
        workflow,
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

  /**
   * 执行任务流程
   * @description
   * 这里串起一次完整的任务执行链路：
   * 1. 激活队列中的可执行任务
   * 2. 根据 workflow 类型分发给对应的 runner
   * 3. 在完成或失败时收束最终事件
   */
  async #workflow() {
    const task = await this.#taskQueue.activateWorkableTask();

    if (!task) {
      return;
    }

    this.#activedTask = task;

    try {
      const taskWorkflow = this.#parseTaskWorkflow(task);
      const runner = this.#pickWorkflowRunner(taskWorkflow);

      if (!runner) {
        throw new Error(`Unknown workflow: ${taskWorkflow}`);
      }

      this.#logger?.debug("Task activated", {
        data: {
          taskId: task.id,
          sessionId: task.sessionId,
          chatId: task.chatId,
          workflow: taskWorkflow,
        },
      });

      const [workflowError, workflowResult] = await toResult(
        runner(task, this.#taskQueue, this.#runtime, this.#serviceManager),
      );

      if (workflowError) {
        this.#handleWorkflowError(task, workflowError, taskWorkflow);
        return;
      }

      if (
        isLegacyWorkflowRunnerResult(workflowResult)
        && workflowResult.decision?.type === "defer_completion"
      ) {
        return;
      }

      if (isPipelineResult(workflowResult) && workflowResult.type === "enqueue") {
        await this.#taskQueue.addTask(workflowResult.nextTask);
        return;
      }

      if (isPipelineResult(workflowResult) && workflowResult.type === "complete") {
        return;
      }
    } catch (error) {
      this.#handleWorkflowError(
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
