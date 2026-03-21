/**
 * 基础服务,为其他服务提供框架架构
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */

import type { AppContext } from "@/types/app";

export class BaseService {
  protected _name: string;
  private _appContext: AppContext;

  constructor(appContext: AppContext) {
    this._name = "base";
    this._appContext = appContext;
  }

  public get name() {
    return this._name;
  }

  public get appContext() {
    return this._appContext;
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
