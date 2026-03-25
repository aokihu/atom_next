/**
 * 系统运行时服务
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */
import type { AppContext } from "@/types/app";
import { BaseService } from "@/services/base";
import { get } from "radashi";

export class RuntimeService extends BaseService {
  #env: Map<string, number | string>;
  #config: object;
  #startedAt: number;

  constructor() {
    super();
    this._name = "runtime";
    this.#env = new Map();
    this.#config = {};

    this.#startedAt = Date.now();
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

  public getAllEnvs() {
    return this.#env;
  }

  /**
   * 获取配置参数变量值
   * @param path 配置参数的key字符串,比如'gateway.enable'
   */
  public getConfig(path: string): any {
    return get(this.#config, path);
  }

  public getAllConfig() {
    return this.#config;
  }

  /**
   * 加载环境变量
   * @param rawEnv 从Bootstrap中提供的环境变量
   */
  public loadEnv(rawEnv: object) {
    Object.entries(rawEnv).forEach(([key, val]) => {
      this.#env.set(key, val);
    });
    return this;
  }

  /**
   * 设置API端口号
   * @param port
   */
  public setPort(port: number) {
    this.#env.set("PORT", port);
    return this;
  }

  /**
   * 加载配置参数
   * @param rawConfig 从Bootstrap中提供的配置
   */
  public loadConfig(rawConfig: object) {
    this.#config = structuredClone(rawConfig);
    return this;
  }

  /**
   * 获取运行时健康信息
   */
  public getHealth() {
    return {
      startedAt: this.#startedAt,
      startup: Date.now() - this.#startedAt,
    };
  }
}
