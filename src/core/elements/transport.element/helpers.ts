import { generateText as runGenerateText, Output, stepCountIs } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ServiceManager } from "@/libs/service-manage";
import type { RuntimeService } from "@/services/runtime";
import { createModelWithProvider } from "./model";
import type {
  TransportGenerateObjectOptions,
  TransportGenerateTextOptions,
  TransportModelProfile,
  TransportPendingToolCall,
  TransportSendOptions,
} from "./types";

export const DEFAULT_MAX_TOOL_STEPS = 5;

type TransportModelKind = "stream" | "text";

type TransportModelCache = {
  key: string;
  model: LanguageModelV3;
};

type TransportModelCacheState = {
  stream: TransportModelCache | null;
  text: TransportModelCache | null;
};

type RawStepToolCall = {
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  args?: unknown;
};

/**
 * Transport model cache is scoped by ServiceManager.
 * This helper-level cache replaces the old Transport instance cache without
 * reintroducing Transport as a runtime component.
 */
const modelCacheRegistry = new WeakMap<ServiceManager, TransportModelCacheState>();

const getRuntimeService = (serviceManager: ServiceManager): RuntimeService => {
  const runtime = serviceManager.getService<RuntimeService>("runtime");

  if (!runtime) {
    throw new Error("Runtime service not found");
  }

  return runtime;
};

const getModelCacheState = (
  serviceManager: ServiceManager,
): TransportModelCacheState => {
  const cacheState = modelCacheRegistry.get(serviceManager);

  if (cacheState) {
    return cacheState;
  }

  const nextState: TransportModelCacheState = {
    stream: null,
    text: null,
  };
  modelCacheRegistry.set(serviceManager, nextState);

  return nextState;
};

const createTransportModel = (modelProfile: TransportModelProfile) => {
  const profilePath = modelProfile.level
    ? `config.providerProfiles.${modelProfile.level}`
    : "transport.modelProfile";

  return createModelWithProvider(
    modelProfile.selectedModel,
    modelProfile.providerConfig,
    profilePath,
  );
};

const buildModelCacheKey = (modelProfile: TransportModelProfile) => {
  return JSON.stringify({
    level: modelProfile.level ?? "",
    modelId: modelProfile.selectedModel.id,
    providerConfig: modelProfile.providerConfig ?? null,
  });
};

const createBalancedModelProfile = (
  serviceManager: ServiceManager,
): TransportModelProfile => {
  return {
    level: "balanced",
    ...getRuntimeService(serviceManager).getModelProfileConfigWithLevel("balanced"),
  };
};

export const resolveTransportModel = (
  serviceManager: ServiceManager,
  kind: TransportModelKind,
  modelProfile?: TransportModelProfile,
) => {
  const cacheState = getModelCacheState(serviceManager);
  const currentCache = kind === "stream" ? cacheState.stream : cacheState.text;
  const setCache = (nextCache: TransportModelCache) => {
    if (kind === "stream") {
      cacheState.stream = nextCache;
      return;
    }

    cacheState.text = nextCache;
  };

  if (!modelProfile) {
    if (currentCache) {
      return currentCache.model;
    }

    const fallbackProfile = createBalancedModelProfile(serviceManager);
    const nextCache = {
      key: buildModelCacheKey(fallbackProfile),
      model: createTransportModel(fallbackProfile),
    } satisfies TransportModelCache;

    setCache(nextCache);
    return nextCache.model;
  }

  const cacheKey = buildModelCacheKey(modelProfile);

  if (currentCache?.key === cacheKey) {
    return currentCache.model;
  }

  const nextCache = {
    key: cacheKey,
    model: createTransportModel(modelProfile),
  } satisfies TransportModelCache;

  setCache(nextCache);
  return nextCache.model;
};

export const resolveTransportToolStopCondition = (
  options: Pick<TransportSendOptions, "tools" | "maxToolSteps">,
) => {
  if (!options.tools) {
    return undefined;
  }

  return stepCountIs(options.maxToolSteps ?? DEFAULT_MAX_TOOL_STEPS);
};

export const normalizePendingToolCalls = (
  steps: Array<{ toolCalls: RawStepToolCall[] }>,
  finishReason: string,
): TransportPendingToolCall[] => {
  if (finishReason !== "tool-calls" || steps.length === 0) {
    return [];
  }

  const lastStep = steps[steps.length - 1];

  if (!lastStep) {
    return [];
  }

  const pendingToolCalls: Array<TransportPendingToolCall | null> = lastStep.toolCalls
    .map((toolCall) => {
      const toolName = toolCall.toolName;

      if (typeof toolName !== "string" || toolName.trim() === "") {
        return null;
      }

      return {
        toolName,
        ...(typeof toolCall.toolCallId === "string"
          ? { toolCallId: toolCall.toolCallId }
          : {}),
        input: toolCall.input ?? toolCall.args ?? {},
      } satisfies TransportPendingToolCall;
    });

  return pendingToolCalls.filter(
    (toolCall): toolCall is TransportPendingToolCall => toolCall !== null,
  );
};

export const generateTransportText = async (
  serviceManager: ServiceManager,
  systemPrompt: string,
  userPrompt: string,
  options: TransportGenerateTextOptions = {},
) => {
  const model = resolveTransportModel(
    serviceManager,
    "text",
    options.modelProfile,
  );
  const result = await runGenerateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal: options.abortSignal,
    maxOutputTokens: options.maxOutputTokens,
  });

  return result.text;
};

export const generateTransportObject = async <TOutput>(
  serviceManager: ServiceManager,
  systemPrompt: string,
  userPrompt: string,
  options: TransportGenerateObjectOptions<TOutput>,
): Promise<TOutput> => {
  const model = resolveTransportModel(
    serviceManager,
    "text",
    options.modelProfile,
  );
  const result = await runGenerateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal: options.abortSignal,
    maxOutputTokens: options.maxOutputTokens,
    output: Output.object({
      schema: options.schema,
      ...(options.schemaName ? { name: options.schemaName } : {}),
      ...(options.schemaDescription
        ? { description: options.schemaDescription }
        : {}),
    }),
  });

  return result.output;
};
