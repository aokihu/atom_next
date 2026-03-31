/**
 * 系统运行时服务
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */
import { isUndefined } from "radashi";
import type { BootArguments } from "@/bootstrap/cli";
import { BaseService } from "@/services/base";
import { get } from "radashi";

export class RuntimeService extends BaseService {
  #arguments: Map<keyof BootArguments, BootArguments[keyof BootArguments]>;
  #config: object;
  #startedAt: number;

  constructor() {
    super();
    this._name = "runtime";
    this.#arguments = new Map();
    this.#config = {};

    this.#startedAt = Date.now();
  }

  override async start() {}

  /**
   * 获取命令行参数值
   * @param arg 参数名称
   * @example
   * runtime.getArgument("port");
   * runtime.getArgument("workspace");
   * runtime.getArgument("serverUrl");
   *
   * // 注意: 这里传入的是 CLI 解析后的参数名,不是环境变量名
   * // 正确: runtime.getArgument("port")
   * // 错误: runtime.getArgument("PORT")
   * @returns 返回命令行参数值
   */
  public getArgument<K extends keyof BootArguments>(
    arg: K,
  ): NonNullable<BootArguments[K]> {
    if (isUndefined(this.#arguments.get(arg))) {
      throw new Error(`CLI argument ${arg} not found`);
    }
    return this.#arguments.get(arg) as NonNullable<BootArguments[K]>;
  }

  /**
   * 获取所有的命令行参数
   * @returns 返回object格式的命令行参数
   */
  public getAllArguments() {
    return Object.fromEntries(this.#arguments);
  }

  /**
   * 获取配置参数变量值
   * @param path 配置参数的key字符串,比如'gateway.enable'
   */
  public getConfig(path: string): number | string | object | undefined {
    return get(this.#config, path);
  }

  public getAllConfig() {
    return this.#config;
  }

  /**
   * 加载命令行参数
   * @param rawArgs 从 Bootstrap 中提供的命令行参数
   */
  public loadCliArgs(rawArgs: BootArguments) {
    Object.entries(rawArgs).forEach(([key, val]) => {
      if (!isUndefined(val)) {
        this.#arguments.set(
          key as keyof BootArguments,
          val as BootArguments[keyof BootArguments],
        );
      }
    });

    return this;
  }

  /**
   * 设置API端口号
   * @param port
   */
  public setPort(port: number) {
    this.#arguments.set("port", port);
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
