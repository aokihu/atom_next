/**
 * 基础服务,为其他服务提供框架架构
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */

import type { ServiceManager } from "@/libs/service-manage";
import type { Service } from "@/types/service";

export class BaseService implements Service {
  protected _serviceManager: ServiceManager | undefined;
  protected _name: string;

  constructor() {
    this._serviceManager = undefined;
    this._name = "base";
  }

  public get name() {
    return this._name;
  }

  // 当注册Service时候执行的回掉方法
  public onRegister(sm: ServiceManager) {
    this._serviceManager = sm;
  }

  public async start() {
    // 服务启动入口
  }

  public async stop() {
    // 服务停止入口
  }

  public async restart() {
    // 服务重启入口
  }
}
