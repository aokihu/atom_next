/**
 * Bootstrap Config Parser
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.1
 * @description 解析 config.json，负责校验结构、填充默认值，并对 provider/model 的命名问题给出温和告警。
 */

import type { PathLike } from "bun";
import { isBoolean, isPlainObject, isString, isUndefined } from "radashi";
import type { Logger } from "@/libs/log";
import {
  DefaultConfig,
  SUPPORTED_PROVIDER_MODELS,
  isConfigProviderModelID,
  isProviderID,
} from "@/types/config";

type ConfigWarningReporter = (path: string, message: string) => void;
type ParseConfigFileOptions = {
  logger?: Logger;
  warn?: ConfigWarningReporter;
};

let reportConfigWarning: ConfigWarningReporter = () => {};
import type {
  ConfigFileScheme,
  GatewayChannelScheme,
  GatewayConfigScheme,
  ProviderDefinition,
  ProviderID,
  ProviderProfiles,
  ProvidersConfigScheme,
} from "@/types/config";

/* -------------------- */
/* Validate Helpers     */
/* -------------------- */

/**
 * 统一生成配置错误，确保报错路径可以直接对应到配置项。
 */
const buildConfigError = (path: string, message: string) => {
  return new Error(`Invalid ${path}: ${message}`);
};

/**
 * 生成配置告警。
 * 这类问题不会阻断启动，但会提示用户相关 provider/model 可能写错了。
 */
const warnConfigIssue = (path: string, message: string) => {
  reportConfigWarning(path, message);
};

/**
 * 校验单个 provider 下的模型名是否合法。
 * `openaiCompatible` 只要求模型名非空，具体兼容模型由用户自行配置。
 */
const isProviderModel = (value: string, provider: ProviderID): boolean => {
  if (provider === "openaiCompatible") {
    return isString(value) && value.trim() !== "";
  }

  return (SUPPORTED_PROVIDER_MODELS[provider] as readonly string[]).includes(
    value,
  );
};

/* -------------------- */
/* Config Parsers       */
/* -------------------- */

/**
 * 解析 providerProfiles 配置。
 * 未提供的档位会回退到默认配置，确保 RuntimeService 总能拿到完整档位。
 */
const parseProviderProfiles = (raw: unknown): ProviderProfiles => {
  const defaultProfiles = DefaultConfig.providerProfiles;

  if (isUndefined(raw)) {
    return structuredClone(defaultProfiles);
  }

  if (!isPlainObject(raw)) {
    throw buildConfigError("config.providerProfiles", "expected an object");
  }

  const providerProfiles = raw as Record<string, unknown>;

  const parseProviderProfileLevel = (level: keyof ProviderProfiles) => {
    const value = providerProfiles[level];

    if (isUndefined(value)) {
      return defaultProfiles[level];
    }

    if (!isString(value) || value.trim() === "") {
      warnConfigIssue(
        `config.providerProfiles.${level}`,
        `expected a non-empty Provider/Model id, fallback to ${defaultProfiles[level]}`,
      );
      return defaultProfiles[level];
    }

    if (!isConfigProviderModelID(value)) {
      warnConfigIssue(
        `config.providerProfiles.${level}`,
        `provider/model format is invalid (${value}), fallback to ${defaultProfiles[level]}`,
      );
      return defaultProfiles[level];
    }

    const separatorIndex = value.indexOf("/");
    const provider = value.slice(0, separatorIndex);
    const model = value.slice(separatorIndex + 1);

    if (!isProviderID(provider)) {
      warnConfigIssue(
        `config.providerProfiles.${level}`,
        `provider name may be invalid (${provider}), it will be handled later by Transport`,
      );
      return value;
    }

    if (!isProviderModel(model, provider)) {
      warnConfigIssue(
        `config.providerProfiles.${level}`,
        `model name may be invalid (${value}), it will be handled later by Transport`,
      );
    }

    return value;
  };

  return {
    advanced: parseProviderProfileLevel("advanced"),
    balanced: parseProviderProfileLevel("balanced"),
    basic: parseProviderProfileLevel("basic"),
  };
};

/**
 * 解析单个 provider 的详细配置。
 * 这里校验的是 provider 自己的模型列表，因此 models 使用裸模型名而不是 `provider/model`。
 */
const parseProviderDefinition = <P extends ProviderID>(
  provider: P,
  raw: unknown,
): ProviderDefinition<P> => {
  if (!isPlainObject(raw)) {
    throw buildConfigError(
      `config.providers.${provider}`,
      "expected an object",
    );
  }

  const providerConfig = raw as Record<string, unknown>;

  if (
    !isString(providerConfig.apiKeyEnv) ||
    providerConfig.apiKeyEnv.trim() === ""
  ) {
    throw buildConfigError(
      `config.providers.${provider}.apiKeyEnv`,
      "expected a non-empty string",
    );
  }

  if (
    !Array.isArray(providerConfig.models) ||
    providerConfig.models.length === 0
  ) {
    throw buildConfigError(
      `config.providers.${provider}.models`,
      "expected a non-empty string array",
    );
  }

  const models = providerConfig.models.map((model, index) => {
    if (!isString(model) || model.trim() === "") {
      throw buildConfigError(
        `config.providers.${provider}.models[${index}]`,
        "expected a non-empty string",
      );
    }

    if (!isProviderModel(model, provider)) {
      warnConfigIssue(
        `config.providers.${provider}.models[${index}]`,
        `model name may be invalid (${model}), it will be handled later by Transport`,
      );
    }

    return model;
  });

  if (
    !isUndefined(providerConfig.baseUrl) &&
    (!isString(providerConfig.baseUrl) || providerConfig.baseUrl.trim() === "")
  ) {
    throw buildConfigError(
      `config.providers.${provider}.baseUrl`,
      "expected a non-empty string",
    );
  }

  if (
    !isUndefined(providerConfig.options) &&
    !isPlainObject(providerConfig.options)
  ) {
    throw buildConfigError(
      `config.providers.${provider}.options`,
      "expected an object",
    );
  }

  return {
    apiKeyEnv: providerConfig.apiKeyEnv,
    models: models as ProviderDefinition<P>["models"],
    baseUrl: providerConfig.baseUrl as string | undefined,
    options: providerConfig.options as Record<string, unknown> | undefined,
  };
};

/**
 * 解析 providers 配置。
 * 未知 provider 会被忽略，已知 provider 则按严格规则校验。
 */
const parseProviders = (raw: unknown): ProvidersConfigScheme => {
  if (isUndefined(raw)) {
    return {};
  }

  if (!isPlainObject(raw)) {
    throw buildConfigError("config.providers", "expected an object");
  }

  const providers: ProvidersConfigScheme = {};

  Object.entries(raw).forEach(([key, value]) => {
    if (key === "deepseek") {
      providers.deepseek = parseProviderDefinition("deepseek", value);
      return;
    }

    if (key === "openai") {
      providers.openai = parseProviderDefinition("openai", value);
      return;
    }

    if (key === "openaiCompatible") {
      providers.openaiCompatible = parseProviderDefinition(
        "openaiCompatible",
        value,
      );
      return;
    }

    warnConfigIssue(
      `config.providers.${key}`,
      "provider name may be invalid, ignore current provider config",
    );
  });

  return providers;
};

/**
 * 解析当前 TUI 主题名。
 * 这里只校验配置值本身是否可用，不负责校验主题是否真实存在。
 */
const parseThemeName = (raw: unknown): string => {
  const defaultTheme = DefaultConfig.theme;

  if (isUndefined(raw)) {
    return defaultTheme;
  }

  if (!isString(raw) || raw.trim() === "") {
    throw buildConfigError("config.theme", "expected a non-empty string");
  }

  return raw;
};

/**
 * 解析主题配置字段。
 * 优先使用当前字段 `theme`，同时兼容旧字段 `themeName`。
 */
const parseThemeConfig = (config: Record<string, unknown>) => {
  if (!isUndefined(config.theme)) {
    return parseThemeName(config.theme);
  }

  return parseThemeName(config.themeName);
};

/**
 * 解析单个 gateway channel。
 */
const parseGatewayChannel = (
  raw: unknown,
  index: number,
): GatewayChannelScheme => {
  if (!isPlainObject(raw)) {
    throw buildConfigError(
      `config.gateway.channels[${index}]`,
      "expected an object",
    );
  }

  const channelConfig = raw as Record<string, unknown>;

  if (!isString(channelConfig.source) || channelConfig.source.trim() === "") {
    throw buildConfigError(
      `config.gateway.channels[${index}].source`,
      "expected a non-empty string",
    );
  }

  if (!isUndefined(channelConfig.enable) && !isBoolean(channelConfig.enable)) {
    throw buildConfigError(
      `config.gateway.channels[${index}].enable`,
      "expected a boolean",
    );
  }

  if (
    !isUndefined(channelConfig.description) &&
    !isString(channelConfig.description)
  ) {
    throw buildConfigError(
      `config.gateway.channels[${index}].description`,
      "expected a string",
    );
  }

  return {
    source: channelConfig.source,
    enable: channelConfig.enable as boolean | undefined,
    description: channelConfig.description as string | undefined,
  };
};

/**
 * 解析 gateway 配置。
 * 缺省时回退到默认配置，channel 数组中的每一项单独校验。
 */
const parseGatewayConfig = (raw: unknown): GatewayConfigScheme => {
  const defaultGateway = DefaultConfig.gateway;

  if (isUndefined(raw)) {
    return structuredClone(defaultGateway);
  }

  if (!isPlainObject(raw)) {
    throw buildConfigError("config.gateway", "expected an object");
  }

  const gatewayConfig = raw as Record<string, unknown>;

  if (!isUndefined(gatewayConfig.enable) && !isBoolean(gatewayConfig.enable)) {
    throw buildConfigError("config.gateway.enable", "expected a boolean");
  }

  if (
    !isUndefined(gatewayConfig.channels) &&
    !Array.isArray(gatewayConfig.channels)
  ) {
    throw buildConfigError("config.gateway.channels", "expected an array");
  }

  return {
    enable:
      (gatewayConfig.enable as boolean | undefined) ?? defaultGateway.enable,
    channels: (
      (gatewayConfig.channels as unknown[] | undefined) ??
      defaultGateway.channels
    ).map((channel, index) => parseGatewayChannel(channel, index)),
  };
};

/**
 * 解析整个配置对象。
 * 这里只处理结构化校验和默认值补全，不负责文件读写。
 */
const parseConfig = (raw: unknown): ConfigFileScheme => {
  if (!isPlainObject(raw)) {
    throw buildConfigError("config", "root must be an object");
  }

  const config = raw as Record<string, unknown>;

  if (!isUndefined(config.version) && config.version !== 2) {
    throw buildConfigError("config.version", "expected 2");
  }

  return {
    version: 2,
    theme: parseThemeConfig(config),
    providerProfiles: parseProviderProfiles(config.providerProfiles),
    providers: parseProviders(config.providers),
    gateway: parseGatewayConfig(config.gateway),
  };
};

/**
 * 解析配置文件
 * @param configFilePath 配置文件路径
 * @param strict 是否严格模式,开启严格模式情况下如果没有找到配置文件,或者配置文件解析失败将会报错
 *               非严格模式下,如果文件不存在或者解析失败,将会返回最小可执行的默认配置参数
 */
export const parseConfigFile: (
  path: PathLike,
  strict?: boolean,
  options?: ParseConfigFileOptions,
) => Promise<ConfigFileScheme> = async (path, strict = false, options = {}) => {
  const previousWarningReporter = reportConfigWarning;
  reportConfigWarning = options.warn ??
    ((warningPath, message) => {
      options.logger?.warn("Config warning", {
        data: {
          path: warningPath,
          message,
        },
      });
    });

  const file = Bun.file(path as string);

  try {
    if (!(await file.exists())) {
      if (strict) {
        throw new Error("Config file not found");
      }

      return structuredClone(DefaultConfig);
    }

    const rawConfig = await file.json();
    return parseConfig(rawConfig);
  } finally {
    reportConfigWarning = previousWarningReporter;
  }
};
