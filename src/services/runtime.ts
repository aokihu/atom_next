/**
 * Runtime Service
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.1
 * @description 统一保存启动参数、配置快照和运行期共享状态，供 Core、TUI 与其他服务读取。
 */
import { isUndefined } from "radashi";
import type { BootArguments } from "@/bootstrap/cli";
import { BaseService } from "@/services/base";
import type { WatchmanStatus } from "@/services/watchman/types";
import { WatchmanPhase } from "@/services/watchman/types";
import { DefaultConfig } from "@/types/config";
import type {
  ConfigProviderModelID,
  ConfigFileScheme,
  ParsedProviderModel,
  ProviderDefinition,
  ProviderID,
  ProviderProfileLevel,
  ProviderProfiles,
} from "@/types/config";
import { isProviderID } from "@/types/config";

type SelectedProviderModelConfig = {
  selectedModel: ParsedProviderModel;
  providerConfig?: ProviderDefinition;
};

export type RuntimeOutputBudget = {
  maxOutputTokens: number;
  requestTokenReserve: number;
  visibleOutputBudget: number;
};

const resolveRequestTokenReserve = (maxOutputTokens: number) => {
  if (maxOutputTokens <= 512) {
    return 96;
  }

  if (maxOutputTokens <= 1024) {
    return 160;
  }

  return 256;
};

export class RuntimeService extends BaseService {
  /* ------------------- */
  /* Properties          */
  /* ------------------- */

  #arguments: Map<keyof BootArguments, BootArguments[keyof BootArguments]>;
  #config: ConfigFileScheme;
  #startedAt: number;
  #userAgentPrompt: string;
  #userAgentPromptStatus: WatchmanStatus;

  /* ------------------- */
  /* Constructor         */
  /* ------------------- */
  constructor() {
    super();
    this._name = "runtime";
    this.#arguments = new Map();
    this.#config = structuredClone(DefaultConfig);
    this.#startedAt = Date.now();
    this.#userAgentPrompt = "";
    this.#userAgentPromptStatus = {
      phase: WatchmanPhase.IDLE,
      hash: null,
      updatedAt: null,
      error: null,
    };
  }

  override async start() {}

  /**
   * 同步用户代理提示词快照
   * @description
   * prompt 和 status 始终作为一份快照原子更新，
   * 避免调用方读到“新状态 + 旧文本”或“新文本 + 旧状态”的中间态。
   */
  #syncUserAgentPromptSnapshot(prompt: string, status: WatchmanStatus) {
    this.#userAgentPrompt = prompt;
    this.#userAgentPromptStatus = structuredClone(status);
    return this;
  }

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
  #parseSelectedProviderModel(id: ConfigProviderModelID): ParsedProviderModel {
    const separatorIndex = id.indexOf("/");

    if (separatorIndex <= 0 || separatorIndex === id.length - 1) {
      throw new Error(`Invalid provider model id: ${id}`);
    }

    return {
      id,
      provider: id.slice(0, separatorIndex),
      model: id.slice(separatorIndex + 1),
    };
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
   * 获取当前 TUI 主题名
   */
  public getThemeName(): string {
    return this.#config.theme;
  }

  /**
   * 获取 formal conversation 的输出 token 上限。
   */
  public getFormalConversationMaxOutputTokens() {
    return this.#config.transport?.formalConversationMaxOutputTokens
      ?? DefaultConfig.transport.formalConversationMaxOutputTokens;
  }

  /**
   * 获取 formal conversation 的输出预算快照。
   */
  public getFormalConversationOutputBudget(): RuntimeOutputBudget | null {
    const maxOutputTokens = this.getFormalConversationMaxOutputTokens();

    if (isUndefined(maxOutputTokens)) {
      return null;
    }

    const requestTokenReserve = resolveRequestTokenReserve(maxOutputTokens);

    return {
      maxOutputTokens,
      requestTokenReserve,
      visibleOutputBudget: Math.max(0, maxOutputTokens - requestTokenReserve),
    };
  }

  /**
   * 获取用户代理提示词
   */
  public getUserAgentPrompt() {
    return this.#userAgentPrompt;
  }

  /**
   * 当前是否持有可用的用户代理提示词
   */
  public hasUserAgentPrompt() {
    return this.#userAgentPrompt !== "";
  }

  /**
   * 获取用户代理提示词状态
   */
  public getUserAgentPromptStatus() {
    return structuredClone(this.#userAgentPromptStatus);
  }

  /**
   * 原子更新用户代理提示词快照
   * @description
   * Watchman 作为生产者时，应优先使用这个接口一次写入完整快照。
   */
  public syncUserAgentPromptSnapshot(prompt: string, status: WatchmanStatus) {
    return this.#syncUserAgentPromptSnapshot(prompt, status);
  }

  /**
   * 兼容旧脚本的单独 prompt 写入接口。
   * @deprecated 优先使用 syncUserAgentPromptSnapshot
   */
  public setUserAgentPrompt(prompt: string) {
    this.#userAgentPrompt = prompt;
    return this;
  }

  /**
   * 兼容旧脚本的单独 status 写入接口。
   * @deprecated 优先使用 syncUserAgentPromptSnapshot
   */
  public setUserAgentPromptStatus(status: WatchmanStatus) {
    this.#userAgentPromptStatus = structuredClone(status);
    return this;
  }

  /**
   * 重置用户代理提示词运行态
   */
  public resetUserAgentPrompt() {
    return this.#syncUserAgentPromptSnapshot("", {
      phase: WatchmanPhase.IDLE,
      hash: null,
      updatedAt: null,
      error: null,
    });
  }

  /**
   * 获取指定档位选中的模型结果
   */
  public getModelProfileWithLevel(
    level: ProviderProfileLevel,
  ): ParsedProviderModel {
    return this.#parseSelectedProviderModel(
      this.#config.providerProfiles[level],
    );
  }

  /**
   * 获取指定档位对应的模型和 provider 配置
   * @description
   * RuntimeService 统一负责把 providerProfiles 中的档位解析成
   * “当前选中的 provider/model”以及该 provider 的详细配置，
   * 避免调用方各自重复拆分 `provider/model` 和二次读取 providers 配置。
   */
  public getModelProfileConfigWithLevel(
    level: ProviderProfileLevel,
  ): SelectedProviderModelConfig {
    const selectedModel = this.getModelProfileWithLevel(level);

    return {
      selectedModel,
      providerConfig: isProviderID(selectedModel.provider)
        ? this.getProviderConfig(selectedModel.provider)
        : undefined,
    };
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
