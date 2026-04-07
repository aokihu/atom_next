import type { BaseService } from "@/services/base";
import { isArray } from "radashi";

type ServiceName = "runtime" | "watchman";

/**
 * 服务管理器
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */

export class ServiceManager {
  #services: Map<string, BaseService> = new Map();

  /**
   * 注册服务对象
   * @param service 服务对象
   */
  public register(...services: Array<BaseService>) {
    services.forEach((service) => {
      this.#services.set(service.name, service);
      service.onRegister(this);
    });
  }

  public getService<T extends BaseService>(name: ServiceName): T | undefined {
    return this.#services.get(name) as T | undefined;
  }

  /**
   * 启动所有的已经注册的服务
   * @param cb 当一个服务启动的时候触发的返回函数,参数是启动的服务名称
   * @returns 所有服务启动结果的 Promise
   */
  public async startAllServices(cb?: (name: string) => void) {
    const tasks = this.#services.values().map((s) => {
      cb?.(s.name);
      return s.start();
    });
    return Promise.allSettled(tasks);
  }
}
