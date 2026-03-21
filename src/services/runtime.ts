/**
 * 系统运行时服务
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */
import type { AppContext } from "@/types/app";
import { BaseService } from "@/services/base";

export class RuntimeService extends BaseService {
  #env: Map<string, number | string>;

  constructor(appContext: AppContext) {
    super(appContext);
    this._name = "runtime";
    this.#env = new Map();
  }

  override async start() {}

  /**
   * 获取环境变量值
   * @param env 环境变量名称
   * @returns 返回环境变量或者undefined
   */
  public getEnv(env: string) {
    return this.#env.get(env);
  }

  /**
   * 加载环境变量
   * @param rawEnv 从Bootstrap中提供的
   */
  public loadEnv(rawEnv: object) {
    console.log(rawEnv);
    Object.entries(rawEnv).forEach(([key, val]) => {
      this.#env.set(key, val);
    });
  }
}
