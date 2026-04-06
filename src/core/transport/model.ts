/**
 * 提供一个统一并且快捷的方式切换AI-SDK的模型
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0
 */
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createDeepSeek, deepseek } from "@ai-sdk/deepseek";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
  ProviderDefinition,
  ProviderID,
  ProviderModelMap,
  SelectedProviderModel,
} from "@/types/config";

/* ==================== */
/*       Private        */
/* ==================== */

const withDeepseek: (
  model: "deepseek-chat" | "deepseek-reasoner",
) => LanguageModelV3 = (model) => {
  return deepseek.languageModel(model);
};

const buildMissingProviderConfigError = (provider: ProviderID) => {
  return new Error(`Missing provider config: ${provider}`);
};

const resolveApiKey = (providerConfig?: ProviderDefinition) => {
  if (!providerConfig) {
    return undefined;
  }

  return process.env[providerConfig.apiKeyEnv];
};

const withConfiguredDeepseek = (
  model: ProviderModelMap["deepseek"],
  providerConfig?: ProviderDefinition<"deepseek">,
) => {
  if (!providerConfig) {
    return withDeepseek(model);
  }

  return createDeepSeek({
    apiKey: resolveApiKey(providerConfig),
    baseURL: providerConfig.baseUrl,
  }).languageModel(model);
};

const withConfiguredOpenAI = (
  model: ProviderModelMap["openai"],
  providerConfig?: ProviderDefinition<"openai">,
) => {
  if (!providerConfig) {
    return openai.languageModel(model);
  }

  return createOpenAI({
    apiKey: resolveApiKey(providerConfig),
    baseURL: providerConfig.baseUrl,
  }).languageModel(model);
};

const withConfiguredOpenAICompatible = (
  model: ProviderModelMap["openaiCompatible"],
  providerConfig?: ProviderDefinition<"openaiCompatible">,
) => {
  if (!providerConfig || !providerConfig.baseUrl) {
    throw buildMissingProviderConfigError("openaiCompatible");
  }

  return createOpenAICompatible({
    name: "openaiCompatible",
    apiKey: resolveApiKey(providerConfig),
    baseURL: providerConfig.baseUrl,
  }).languageModel(model);
};

type ModelFactoryMap = Partial<{
  [P in ProviderID]: (
    model: ProviderModelMap[P],
    providerConfig?: ProviderDefinition<P>,
  ) => LanguageModelV3;
}>;

/**
 * 按 provider 维护模型工厂映射。
 * 后续新增 provider 时，只需要补充对应工厂，不需要继续扩展 createModelWithProvider。
 */
const modelFactories: ModelFactoryMap = {
  deepseek: withConfiguredDeepseek,
  openai: withConfiguredOpenAI,
  openaiCompatible: withConfiguredOpenAICompatible,
};

/* ==================== */
/*       Public         */
/* ==================== */

/**
 * 根据供应商创建模型
 * @param selectedModel RuntimeService 提供的选中模型
 * @param providerConfig RuntimeService 提供的 provider 详细配置
 */
export const createModelWithProvider = (
  selectedModel: SelectedProviderModel,
  providerConfig?: ProviderDefinition,
) => {
  const factory = modelFactories[selectedModel.provider];

  if (factory) {
    return (
      factory as (
        model: string,
        providerConfig?: ProviderDefinition,
      ) => LanguageModelV3
    )(
      selectedModel.model,
      providerConfig,
    );
  }

  throw new Error(`Unsupported provider: ${selectedModel.provider}`);
};
