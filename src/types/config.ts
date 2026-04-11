/**
 * Config Types
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.1
 * @description 定义 config.json、provider 和 gateway 的类型边界，以及默认配置常量。
 */

/**
 * 当前项目支持的 LLM 供应商标识。
 * `openaiCompatible` 用于兼容 OpenAI 协议的三方服务。
 */
export type ProviderID = "deepseek" | "openai" | "openaiCompatible";

/**
 * 当前项目支持的 provider 常量列表。
 * 运行时校验和配置解析都应复用这份集合，避免重复维护。
 */
export const SUPPORTED_PROVIDERS = [
  "deepseek",
  "openai",
  "openaiCompatible",
] as const satisfies ProviderID[];

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
 * 当前项目支持的 provider-model 元数据。
 * `openaiCompatible` 不穷举模型名，因此这里只维护固定模型集合的 provider。
 */
export const SUPPORTED_PROVIDER_MODELS = {
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-5", "gpt-5-mini"],
} as const satisfies Partial<{
  [P in ProviderID]: readonly ProviderModelMap[P][];
}>;

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

/**
 * ProviderProfiles 的档位名称。
 * 用于从运行时配置中读取对应难度的模型预设。
 */
export type ProviderProfileLevel = keyof ProviderProfiles;

/**
 * 按档位选中的 provider-model 结果。
 * 运行时拿到该结构后，不需要再手动拆分 `Provider/Model` 字符串。
 */
export type SelectedProviderModel<P extends ProviderID = ProviderID> = {
  id: ProviderModelID<P>;
  provider: P;
  model: ProviderModelMap[P];
};

/**
 * Message Gateway 单个通道配置。
 */
export type GatewayChannelScheme = {
  source: string;
  enable?: boolean;
  description?: string;
};

/**
 * Message Gateway 总配置。
 */
export type GatewayConfigScheme = {
  enable: boolean;
  channels: GatewayChannelScheme[];
};

/**
 * config.json 的完整结构。
 */
export type ConfigFileScheme = {
  version: 2;
  // 当前 TUI 使用的主题名称
  theme: string;
  // 模型档位配置，可以三个档位都指向同一个模型
  providerProfiles: ProviderProfiles;
  // LLM 供应商配置
  providers: ProvidersConfigScheme;
  // Message Gateway 配置
  gateway: GatewayConfigScheme;
};

/**
 * 默认配置只负责提供最小可执行结构，
 * 具体业务值仍然由 workspace 下的 config.json 覆盖。
 */
export const DefaultConfig: ConfigFileScheme = {
  version: 2,
  theme: "nord",
  providerProfiles: {
    advanced: "deepseek/deepseek-chat",
    balanced: "deepseek/deepseek-chat",
    basic: "deepseek/deepseek-chat",
  },
  providers: {},
  gateway: {
    enable: false,
    channels: [],
  },
};
