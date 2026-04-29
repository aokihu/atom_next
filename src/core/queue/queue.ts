/**
 * @author aokihu <aokihu@gmail.com>
 * @class TaskQueue
 * @classdesc 核心任务队列对象
 *            提供推入任务/推出任务/任务自动排列等功能
 *            是内核中执行任务的唯一管道
 */

import {
  ChatEvents,
  type ChatActivatedEventPayload,
  type ChatEnqueuedEventPayload,
} from "@/types/event";
import { ChatStatus } from "@/types/chat";
import type { TaskItem, TaskItems } from "@/types/task";
import { TaskSource } from "@/types/task";
import { TaskState } from "@/types/task";
import { isNullish } from "radashi";

export class TaskQueue {
  /* ==================== */
  /*  Private Properties  */
  /* ==================== */

  // 不同权重的任务队列
  #queues: Map<number, TaskItems>;

  // 激活并且正在执行的任务队列
  #activeQueue: TaskItem[];

  /* ==================== */
  /*  Constructor         */
  /* ==================== */

  constructor() {
    this.#queues = new Map();
    this.#activeQueue = [];
  }

  /* ==================== */
  /*  Private Methods     */
  /* ==================== */

  /**
   * 将任务状态映射为 chat 状态
   * @description 这是队列侧的状态同步细节，只服务当前文件的事件构建。
   *              放在这里可以保持 types 文件只负责声明，不混入状态转换逻辑。
   */
  #parseTaskStateToChatStatus(state: TaskState): ChatStatus | undefined {
    if (state === TaskState.WAITING) {
      return ChatStatus.WAITING;
    }

    if (state === TaskState.PENDING) {
      return ChatStatus.PENDING;
    }

    if (state === TaskState.PROCESSING) {
      return ChatStatus.PROCESSING;
    }

    if (state === TaskState.COMPLETED) {
      return ChatStatus.COMPLETED;
    }

    if (state === TaskState.FAILED) {
      return ChatStatus.FAILED;
    }

    return undefined;
  }

  /**
   * 获取对应优先级的队列或者创建一个对应优先级的队列
   * @param priority 任务优先级
   * @returns 返回对应优先级的队列
   */
  #getOrCreateQueue(priority: number): TaskItems {
    if (!this.#queues.has(priority)) {
      this.#queues.set(priority, []);
    }
    return this.#queues.get(priority)!;
  }

  /**
   * 从等待队列中获取下一个可执行任务
   * @description 这里只负责按照优先级取任务，不处理激活状态切换
   */
  #getNextWorkableTask() {
    const queues = [...this.#queues.keys()].sort((a, b) => a - b);
    for (const priority of queues) {
      const queue = this.#queues.get(priority)!;
      if (queue.length === 0) {
        continue;
      }

      return queue.shift()!;
    }

    return undefined;
  }

  /**
   * 将任务放入激活队列
   * @param task 需要激活的任务
   */
  #activateTask(task: TaskItem) {
    const activeTask = this.#activeQueue.find((item) => item.id === task.id);

    if (!isNullish(activeTask)) {
      return activeTask;
    }

    task.state = TaskState.PENDING;
    task.updatedAt = Date.now();

    this.#activeQueue.push(task);
    this.#syncTaskState(task);

    return task;
  }

  /**
   * 从激活队列中移除任务
   * @param taskId 任务ID
   */
  #removeTaskFromActiveQueue(taskId: string) {
    const taskIndex = this.#activeQueue.findIndex((task) => task.id === taskId);
    return taskIndex < 0 ? undefined : this.#activeQueue.splice(taskIndex, 1);
  }

  /**
   * 根据ID查找任务
   * @param taskId 任务ID
   * @returns 当前任务
   */
  #findTaskById(taskId: string) {
    const waitingTask = [...this.#queues.values()]
      .flat()
      .find((task) => task.id === taskId);

    return !isNullish(waitingTask)
      ? waitingTask
      : this.#activeQueue.find((task) => task.id === taskId);
  }

  /**
   * 根据任务状态推断要发送的 Chat 事件
   * @param state 任务状态
   * @returns 对应的事件名
   * @description 队列层只负责同步“任务状态切换”本身。
   *              输出增量和完成/失败等业务事件由 workflow/core 显式发出。
   */
  #parseTaskEvent(state: TaskState) {
    if (state === TaskState.WAITING) {
      return ChatEvents.CHAT_ENQUEUED;
    }

    if (state === TaskState.PENDING) {
      return ChatEvents.CHAT_ACTIVATED;
    }

    return undefined;
  }

  /**
   * 向事件对象同步任务状态
   * @param task 当前任务
   * @description 这里发送的都是“状态已经切换”的通知，不附带输出增量。
   *              如果需要排查 output delta 丢失或处理阶段异常，应优先看 Core 发出的 CHAT_OUTPUT_UPDATED。
   */
  #syncTaskState(task: TaskItem) {
    if (task.source !== TaskSource.EXTERNAL || isNullish(task.eventTarget)) {
      return;
    }

    const event = this.#parseTaskEvent(task.state);
    const status = this.#parseTaskStateToChatStatus(task.state);
    if (isNullish(event) || isNullish(status)) {
      return;
    }

    if (event === ChatEvents.CHAT_ENQUEUED && status === ChatStatus.WAITING) {
      const payload: ChatEnqueuedEventPayload = {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status,
      };

      task.eventTarget.emit(event, payload);
      return;
    }

    if (event === ChatEvents.CHAT_ACTIVATED && status === ChatStatus.PENDING) {
      const payload: ChatActivatedEventPayload = {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status,
      };

      task.eventTarget.emit(event, payload);
    }
  }

  /* ==================== */
  /* Public getter/setter */
  /* ==================== */

  public get isEmpty() {
    return [...this.#queues.values()].every((queue) => queue.length === 0);
  }

  /* ==================== */
  /*  Public Methods      */
  /* ==================== */

  /**
   * 添加新的任务到队列中
   * @param task 新添加的任务,由createTaskItem组装,这里不检查数据的安全和完整
   */
  public async addTask(task: TaskItem) {
    const { priority } = task;
    const queue = this.#getOrCreateQueue(priority);
    queue.push(task);
    this.#syncTaskState(task);
  }

  /**
   * 获取并激活下一个可工作的任务
   * @description 这是runtime从队列中领取任务的唯一入口
   *              领取成功后任务会从等待队列移除并进入激活队列
   */
  public async activateWorkableTask() {
    const task = this.#getNextWorkableTask();
    return isNullish(task) ? undefined : this.#activateTask(task);
  }

  /**
   * 更新任务
   * @param taskId 需要更新的任务id
   * @param newStatus 任务的新状态
   * @param options 是否同步对外事件
   * @throws {Error} 任务未找到
   * @throws {Error} 更新失败,无效的属性字段,只能更新updatedAt和state
   * @description 这里只能更新任务的 updatedAt/state 等时间和状态信息，
   *              不承担业务结果(message/error)的同步职责。
   */
  public updateTask(
    taskId: string,
    newStatus: Record<"state", TaskState>,
    options: { shouldSyncEvent?: boolean } = {},
  ) {
    const task = this.#findTaskById(taskId);

    if (isNullish(task)) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.state = newStatus.state;
    task.updatedAt = Date.now();

    if (
      task.state !== TaskState.PENDING &&
      task.state !== TaskState.PROCESSING
    ) {
      this.#removeTaskFromActiveQueue(task.id);
    }

    if (options.shouldSyncEvent !== false) {
      this.#syncTaskState(task);
    }
  }
}
