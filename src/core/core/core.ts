import type { TaskItem } from "@/types/queue";
import type { ServiceManager } from "@/libs/service-manage";
import { TaskQueue } from "../queue";
import { Runtime } from "../runtime";
import { Transport } from "../transport";

export class Core {
  static readonly ACTIVATE_TASK_DELAY = 1000;

  #serviceManager: ServiceManager;
  #taskQueue: TaskQueue;
  #runtime: Runtime;
  #transport: Transport;

  #activeTimer: NodeJS.Timeout | null = null;

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
   * 清理已存在的激活定时器
   */
  #clearActivateTaskTimer() {
    if (!this.#activeTimer) return;

    clearTimeout(this.#activeTimer);
    this.#activeTimer = null;
  }

  /**
   * 延迟再次尝试激活任务
   * @description 这里只负责调度下一次激活，不处理任务本身
   */
  #scheduleActivateTask() {
    this.#clearActivateTaskTimer();
    this.#activeTimer = setTimeout(() => {
      this.#activeTimer = null;
      this.#activateTask();
    }, Core.ACTIVATE_TASK_DELAY);
  }

  /**
   * 获取等待的任务并激活
   * @description 这是一个内部循环执行的函数
   *              当队列中没有任务的时候会尝试等待一定时间后再次唤醒函数尝试获取
   *              使用setTimeout的方式实现循环
   */
  #activateTask() {
    this.#clearActivateTaskTimer();

    if (this.#taskQueue.isEmpty) {
      this.#scheduleActivateTask();
      return;
    }

    return this.#taskQueue.activateWorkableTask();
  }

  /* ==================== */
  /*        Public        */
  /* ==================== */

  /**
   * 向内核添加任务,这个任务由buildTasl
   * @param task
   */
  async addTask(task: TaskItem) {
    await this.#taskQueue.addTask(task);
  }
}
