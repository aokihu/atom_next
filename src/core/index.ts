/**
 * Atom核心
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */

import type { TaskItem } from "@/types/queue";
import { TaskQueue, buildTaskItem } from "./queue";
import type { AppContext } from "@/types/app";

export class Core {
  #taskQueue: TaskQueue;

  constructor(appContext: AppContext) {
    this.#taskQueue = new TaskQueue(appContext);
  }
}
