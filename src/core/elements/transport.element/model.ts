/**
 * 提供一个统一并且快捷的方式切换AI-SDK的模型
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0
 */
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createDeepSeek, deepseek } from "@ai-sdk/deepseek";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isString } from "radashi";
import type {
  DeepseekModelID,
  OpenAIModelID,
  ParsedProviderModel,
  ProviderDefinition,
  ProviderID,
  ProviderModelMap,
  SelectedProviderModel,
} from "@/types/config";
import {
  isProviderID,
} from "@/types/config";

const withDeepseek: (
  model: "deepseek-chat" | "deepseek-reasoner",
) => LanguageModelV3 = (model) => {
  return deepseek.languageModel(model);
};

const buildProviderConfigError = (message: string) => {
  return new Error(`Invalid transport provider config: ${message}`);
};

const buildModelConfigError = (message: string) => {
  return new Error(`Invalid transport model config: ${message}`);
};

const getProviderConfigPath = (provider: string) => {
  return `config.providers.${provider}`;
};

const parseProviderModel = (
  selectedModel: ParsedProviderModel,
  providerConfig: ProviderDefinition | undefined,
  profilePath: string,
): SelectedProviderModel => {
  if (!isProviderID(selectedModel.provider)) {
    throw buildModelConfigError(
      `${profilePath} contains unsupported provider (${selectedModel.provider})`,
    );
  }

  if (selectedModel.provider === "openaiCompatible") {
    return {
      id: selectedModel.id as SelectedProviderModel<"openaiCompatible">["id"],
      provider: selectedModel.provider,
      model: selectedModel.model as SelectedProviderModel<"openaiCompatible">["model"],
    };
  }

  return {
    id: selectedModel.id as SelectedProviderModel["id"],
    provider: selectedModel.provider,
    model: selectedModel.model as SelectedProviderModel["model"],
  };
};

const validateProviderModelMatch = <P extends ProviderID>(
  selectedModel: SelectedProviderModel<P>,
  providerConfig: ProviderDefinition<P>,
  profilePath: string,
) => {
  if (!(providerConfig.models as string[]).includes(selectedModel.model)) {
    throw buildModelConfigError(
      `${profilePath} selects ${selectedModel.id}, but ${getProviderConfigPath(selectedModel.provider)}.models does not include ${selectedModel.model}`,
    );
  }
};

const validateProviderApiKey = (
  provider: string,
  providerConfig: ProviderDefinition,
) => {
  const apiKey = process.env[providerConfig.apiKeyEnv];

  if (!isString(apiKey) || apiKey.trim() === "") {
    throw buildProviderConfigError(
      `${getProviderConfigPath(provider)}.apiKeyEnv points to missing env ${providerConfig.apiKeyEnv}`,
    );
  }

  return apiKey;
};

const parseConfiguredProviderModel = (
  selectedModel: ParsedProviderModel,
  providerConfig: ProviderDefinition | undefined,
  profilePath: string,
) => {
  const parsedModel = parseProviderModel(
    selectedModel,
    providerConfig,
    profilePath,
  );

  if (providerConfig) {
    validateProviderModelMatch(
      parsedModel as SelectedProviderModel,
      providerConfig as ProviderDefinition,
      profilePath,
    );
  }

  return parsedModel;
};

const withConfiguredDeepseek = (
  model: DeepseekModelID,
  providerConfig?: ProviderDefinition<"deepseek">,
) => {
  if (!providerConfig) {
    return withDeepseek(model);
  }

  return createDeepSeek({
    apiKey: validateProviderApiKey("deepseek", providerConfig),
    baseURL: providerConfig.baseUrl,
  }).languageModel(model);
};

const withConfiguredOpenAI = (
  model: OpenAIModelID,
  providerConfig?: ProviderDefinition<"openai">,
) => {
  if (!providerConfig) {
    return openai.languageModel(model);
  }

  return createOpenAI({
    apiKey: validateProviderApiKey("openai", providerConfig),
    baseURL: providerConfig.baseUrl,
  }).languageModel(model);
};

const withConfiguredOpenAICompatible = (
  model: ProviderModelMap["openaiCompatible"],
  providerConfig?: ProviderDefinition<"openaiCompatible">,
) => {
  if (!providerConfig) {
    throw buildProviderConfigError(
      `missing ${getProviderConfigPath("openaiCompatible")} for openaiCompatible`,
    );
  }

  if (!providerConfig.baseUrl) {
    throw buildProviderConfigError(
      `missing ${getProviderConfigPath("openaiCompatible")}.baseUrl for openaiCompatible`,
    );
  }

  return createOpenAICompatible({
    name: "openaiCompatible",
    apiKey: validateProviderApiKey("openaiCompatible", providerConfig),
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

export const createModelWithProvider = (
  selectedModel: ParsedProviderModel,
  providerConfig?: ProviderDefinition,
  profilePath = "config.providerProfiles.balanced",
) => {
  const parsedModel = parseConfiguredProviderModel(
    selectedModel,
    providerConfig,
    profilePath,
  );
  const factory = modelFactories[parsedModel.provider];

  if (factory) {
    return (
      factory as (
        model: string,
        providerConfig?: ProviderDefinition,
      ) => LanguageModelV3
    )(
      parsedModel.model,
      providerConfig,
    );
  }

  throw buildModelConfigError(
    `${profilePath} resolved unsupported provider (${parsedModel.provider})`,
  );
};
