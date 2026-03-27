/**
 * Atom核心
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */

import type { TaskItem } from "@/types/queue";
import { TaskQueue } from "../queue";
import type { AppContext } from "@/types/app";
import type { ServiceManager } from "@/libs/service-manage";

export class Core {
  #serviceManager: ServiceManager;
  #taskQueue: TaskQueue;

  constructor(serviceManager: ServiceManager) {
    this.#serviceManager = serviceManager;
    this.#taskQueue = new TaskQueue();
  }

  /* -------------------- */
  /*        Public        */
  /* -------------------- */

  /**
   * 向内核添加任务,这个任务由buildTasl
   * @param task
   */
  addTask(task: TaskItem) {
    this.#taskQueue.addTask(task);
  }
}
