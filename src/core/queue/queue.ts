/**
 * @author aokihu <aokihu@gmail.com>
 * @class TaskQueue
 * @classdesc 核心任务队列对象
 *            提供推入任务/推出任务/任务自动排列等功能
 *            是内核中执行任务的唯一管道
 */

import { APIEvents, parseTaskStateToChatStatus, type Chat } from "@/types/api";
import type { TaskItem, TaskItems } from "@/types/queue";
import { TaskSource } from "@/types/queue";
import { TaskState } from "@/types/queue";
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
   * 根据任务状态推断要发送的API事件
   * @param state 任务状态
   * @returns 对应的事件名
   */
  #parseTaskEvent(state: TaskState) {
    if (
      state === TaskState.WAITING ||
      state === TaskState.PENDING ||
      state === TaskState.PROCESSING
    ) {
      return APIEvents.CHAT_UPDATED;
    }

    if (state === TaskState.COMPLETE) {
      return APIEvents.CHAT_FINISHED;
    }

    if (state === TaskState.FAILED) {
      return APIEvents.CHAT_FAILED;
    }

    return undefined;
  }

  /**
   * 向API事件对象同步任务状态
   * @param task 当前任务
   */
  #syncTaskState(task: TaskItem) {
    if (task.source !== TaskSource.EXTERNAL || isNullish(task.eventTarget)) {
      return;
    }

    const event = this.#parseTaskEvent(task.state);
    const status = parseTaskStateToChatStatus(task.state);
    if (isNullish(event) || isNullish(status)) {
      return;
    }

    task.eventTarget.emit(event, {
      sessionId: task.sessionId,
      chatId: task.chatId,
      status,
    } satisfies Partial<Chat>);
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
   * @param task 新添加的任务,由buildTaskItem组装,这里不检查数据的安全和完整
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
   * @throws {Error} 任务未找到
   * @throws {Error} 更新失败,无效的属性字段,只能更新updatedAt和state
   * @description 这里只能更新任务的updatedAt/state等时间和状态信息,其他数据都是不可修改的
   */
  public updateTask(taskId: string, newStatus: Record<"state", TaskState>) {
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

    this.#syncTaskState(task);
  }
}
