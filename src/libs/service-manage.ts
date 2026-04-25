import type { BaseService } from "@/services/base";
import type { Logger } from "@/libs/log";

type ServiceName = "runtime" | "watchman" | "memory" | "tools";
type ServiceManagerOptions = {
  logger?: Logger;
};

/**
 * 服务管理器
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */

export class ServiceManager {
  #services: Map<string, BaseService> = new Map();
  #logger: Logger | undefined;

  constructor(options: ServiceManagerOptions = {}) {
    this.#logger = options.logger;
  }

  /* ==================== */
  /* 私有方法              */
  /* ==================== */

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
    const tasks = this.#services.values().map(async (service) => {
      cb?.(service.name);
      this.#logger?.info("Service starting", {
        data: {
          service: service.name,
        },
      });

      try {
        await service.start();
        this.#logger?.info("Service started", {
          data: {
            service: service.name,
          },
        });
      } catch (error) {
        this.#logger?.error("Service startup failed", {
          error,
          data: {
            service: service.name,
          },
        });
        throw error;
      }
    });
    return Promise.allSettled(tasks);
  }
}
