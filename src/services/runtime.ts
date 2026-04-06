/**
 * 系统运行时服务
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0.0
 */
import { isUndefined } from "radashi";
import type { BootArguments } from "@/bootstrap/cli";
import { BaseService } from "@/services/base";
import { DefaultConfig } from "@/types/config";
import type {
  ConfigFileScheme,
  ProviderDefinition,
  ProviderID,
  ProviderModelID,
  ProviderModelMap,
  ProviderProfileLevel,
  ProviderProfiles,
  SelectedProviderModel,
} from "@/types/config";

export class RuntimeService extends BaseService {
  /* =================== */
  /*      Properties     */
  /* =================== */

  #arguments: Map<keyof BootArguments, BootArguments[keyof BootArguments]>;
  #config: ConfigFileScheme;
  #startedAt: number;

  /* =================== */
  /*      Constructor    */
  /* =================== */
  constructor() {
    super();
    this._name = "runtime";
    this.#arguments = new Map();
    this.#config = structuredClone(DefaultConfig);
    this.#startedAt = Date.now();
  }

  override async start() {}

  /**
   * 读取命令行参数。
   * 这里只服务 RuntimeService 内部，外部统一通过语义化方法获取配置。
   */
  #readArgument<K extends keyof BootArguments>(
    arg: K,
  ): NonNullable<BootArguments[K]> {
    if (isUndefined(this.#arguments.get(arg))) {
      throw new Error(`CLI argument ${arg} not found`);
    }

    return this.#arguments.get(arg) as NonNullable<BootArguments[K]>;
  }

  /**
   * 解析 Provider/Model 形式的模型标识。
   */
  #parseSelectedProviderModel(id: ProviderModelID): SelectedProviderModel {
    const separatorIndex = id.indexOf("/");

    if (separatorIndex <= 0 || separatorIndex === id.length - 1) {
      throw new Error(`Invalid provider model id: ${id}`);
    }

    const provider = id.slice(0, separatorIndex);
    const model = id.slice(separatorIndex + 1);

    if (provider === "deepseek") {
      return {
        id,
        provider,
        model: model as ProviderModelMap["deepseek"],
      };
    }

    if (provider === "openai") {
      return {
        id,
        provider,
        model: model as ProviderModelMap["openai"],
      };
    }

    if (provider === "openaiCompatible") {
      return {
        id,
        provider,
        model: model as ProviderModelMap["openaiCompatible"],
      };
    }

    throw new Error(`Unsupported provider: ${provider}`);
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
   * 获取当前启动模式
   */
  public getMode(): BootArguments["mode"] {
    return this.#readArgument("mode");
  }

  /**
   * 获取工作目录
   */
  public getWorkspace(): string {
    return this.#readArgument("workspace");
  }

  /**
   * 获取沙箱目录
   */
  public getSandbox(): string {
    return this.#readArgument("sandbox");
  }

  /**
   * 获取服务器URL
   */
  public getServerUrl(): string {
    return this.#readArgument("serverUrl");
  }

  /**
   * 获取服务器监听地址
   */
  public getServerAddress(): string {
    return this.#readArgument("address");
  }

  /**
   * 获取API监听端口
   */
  public getListenPort(): number {
    return this.#readArgument("port");
  }

  /**
   * 获取所有的命令行参数
   * @returns 返回object格式的命令行参数
   */
  public getAllArguments(): Partial<BootArguments> {
    return Object.fromEntries(this.#arguments) as Partial<BootArguments>;
  }

  /**
   * 获取模型档位配置
   */
  public getProviderProfiles(): ProviderProfiles {
    return structuredClone(this.#config.providerProfiles);
  }

  /**
   * 获取指定档位选中的模型结果
   */
  public getModelProfileWithLevel(
    level: ProviderProfileLevel,
  ): SelectedProviderModel {
    return this.#parseSelectedProviderModel(
      this.#config.providerProfiles[level],
    );
  }

  /**
   * 获取指定 provider 的详细配置。
   * provider 未在配置中声明时，返回 undefined。
   */
  public getProviderConfig<P extends ProviderID>(
    provider: P,
  ): ProviderDefinition<P> | undefined {
    const providerConfig = this.#config.providers[provider];

    if (isUndefined(providerConfig)) {
      return undefined;
    }

    return structuredClone(providerConfig) as ProviderDefinition<P>;
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
  public loadConfig(rawConfig: ConfigFileScheme) {
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
