import {
  APIEvents,
  parseTaskStateToChatStatus,
  type Chat,
} from "@/types/api";
import type { TaskItem, TaskItems } from "@/types/queue";
import { TaskSource } from "@/types/queue";
import { TaskState } from "@/types/queue";
import { isNullish } from "radashi";

/**
 * @author aokihu <aokihu@gmail.com>
 * @class TaskQueue
 * @classdesc 核心任务队列对象
 *            提供推入任务/推出任务/任务自动排列等功能
 *            是内核中执行任务的唯一管道
 */
export class TaskQueue {
  // 不同权重的任务队列
  #queues: Map<number, TaskItems>;

  /* 构造函数 */
  constructor() {
    this.#queues = new Map();
  }

  /* --- Private --- */

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
      status,
    } satisfies Partial<Chat>);
  }

  /* --- Public --- */

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
   * 从队列中获取可以工作的任务
   * @description 这个方法是runtime从队列中获取任务的唯一途径
   *              获取任务之后这个任务就会弹出队列
   */
  public async getWorkableTask() {
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
   * 更新任务
   * @param taskId 需要更新的任务id
   * @param newStatus 任务的新状态
   * @throws {Error} 任务未找到
   * @throws {Error} 更新失败,无效的属性字段,只能更新updatedAt和state
   * @description 这里只能更新任务的updatedAt/state等时间和状态信息,其他数据都是不可修改的
   */
  public updateTask(taskId: string, newStatus: Record<"state", TaskState>) {
    const tasks = [...this.#queues.values()].flat();
    const task = tasks.find((t) => t.id === taskId);

    if (isNullish(task)) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.state = newStatus.state;
    task.updatedAt = Date.now();
    this.#syncTaskState(task);
  }
}
