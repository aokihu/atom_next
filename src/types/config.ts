/**
 * 配置文件相关类型
 */

/**
 * 当前项目支持的 LLM 供应商标识。
 * `openaiCompatible` 用于兼容 OpenAI 协议的三方服务。
 */
export type ProviderID = "deepseek" | "openai" | "openaiCompatible";

/**
 * DeepSeek 当前在项目中显式支持的模型。
 */
export type DeepseekModelID = "deepseek-chat" | "deepseek-reasoner";

/**
 * OpenAI 当前在项目中显式支持的模型。
 * 这里只维护项目已接入的模型集合，不追求穷举全部官方模型。
 */
export type OpenAIModelID =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-5"
  | "gpt-5-mini";

/**
 * OpenAI Compatible 的模型名无法在类型层稳定穷举，
 * 因此保留为 string，由运行时配置决定具体值。
 */
export type OpenAICompatibleModelID = string;

/**
 * 供应商和模型类型的对应关系。
 * 后续新增 provider 时，只需要在这里补上映射即可。
 */
export type ProviderModelMap = {
  deepseek: DeepseekModelID;
  openai: OpenAIModelID;
  openaiCompatible: OpenAICompatibleModelID;
};

/**
 * 模型完整标识，格式为 `Provider/Model`。
 * 例如：
 * - `deepseek/deepseek-chat`
 * - `openai/gpt-5`
 * - `openaiCompatible/my-custom-model`
 */
export type ProviderModelID<P extends ProviderID = ProviderID> = {
  [K in P]: `${K}/${ProviderModelMap[K]}`;
}[P];

/**
 * 供应商配置项。
 * `models` 只声明当前 provider 下允许使用的模型名，不包含 provider 前缀。
 */
export type ProviderDefinition<P extends ProviderID = ProviderID> = {
  models: ProviderModelMap[P][];
  baseUrl?: string;
  apiKeyEnv: string;
  options?: Record<string, unknown>;
};

/**
 * 所有供应商配置。
 * key 使用固定的 ProviderID，避免出现任意字符串键。
 */
export type ProvidersConfigScheme = Partial<{
  [P in ProviderID]: ProviderDefinition<P>;
}>;

/**
 * 预设的模型档位。
 * 用于根据任务难度选择不同智能层级的模型。
 */
export type ProviderProfiles = {
  advanced: ProviderModelID;
  balanced: ProviderModelID;
  basic: ProviderModelID;
};

/* Message Gateway 通道配置 */
export type GatewayChannelScheme = {
  source: string;
  enable?: boolean;
  description?: string;
};

export type GatewayConfigScheme = {
  enable: boolean;
  channels: GatewayChannelScheme[];
};

export type ConfigFileScheme = {
  version: 2;
  // 模型档位配置，可以三个档位都指向同一个模型
  providerProfiles: ProviderProfiles;
  // LLM 供应商配置
  providers: ProvidersConfigScheme;
  // Message Gateway 配置
  gateway: GatewayConfigScheme;
};
