/**
 * 服务管理器
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */

import type { BaseService } from "@/services/base";

type ServiceName = "runtime";

export class ServiceManager {
  #services: Map<string, BaseService> = new Map();

  /**
   * 注册服务对象
   * @param service 服务对象
   */
  public register(service: BaseService) {
    this.#services.set(service.name, service);
  }

  public getService<T extends BaseService>(name: ServiceName): T | undefined {
    return this.#services.get(name) as T | undefined;
  }

  public async start(cb?: (name: string) => never) {
    const tasks = this.#services.values().map((s) => {
      cb?.(s.name);
      return s.start();
    });
    await Promise.allSettled(tasks);
    cb?.("All service");
  }
}
