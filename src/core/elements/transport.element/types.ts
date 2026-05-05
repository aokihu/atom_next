/**
 * Transport element types.
 *
 * Defines the transport payload, output, and related configuration types
 * consumed by createTransportElement and its helpers.
 */
import type { FinishReason, LanguageModelUsage } from "ai";
import type { ZodType } from "zod";
import type { ToolDefinitionMap } from "@/services/tools";
import type {
  ParsedProviderModel,
  ProviderDefinition,
  ProviderProfileLevel,
} from "@/types/config";

export type TransportModelProfile = {
  level?: ProviderProfileLevel;
  selectedModel: ParsedProviderModel;
  providerConfig?: ProviderDefinition;
};

export type TransportToolCallStartEvent = {
  toolName: string;
  toolCallId?: string;
  input: unknown;
};

export type TransportToolCallFinishEvent = {
  toolName: string;
  toolCallId?: string;
  input: unknown;
  result?: unknown;
  error?: unknown;
};

export type TransportPendingToolCall = {
  toolName: string;
  toolCallId?: string;
  input: unknown;
};

export type TransportSendOptions = {
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  modelProfile?: TransportModelProfile;
  tools?: ToolDefinitionMap;
  maxToolSteps?: number;
  onTextDelta?: (textDelta: string) => void | Promise<void>;
  onToolCallStart?: (
    event: TransportToolCallStartEvent,
  ) => void | Promise<void>;
  onToolCallFinish?: (
    event: TransportToolCallFinishEvent,
  ) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
};

export type TransportGenerateTextOptions = {
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  modelProfile?: TransportModelProfile;
};

export type TransportGenerateObjectOptions<TOutput> =
  TransportGenerateTextOptions & {
    schema: ZodType<TOutput>;
    schemaName?: string;
    schemaDescription?: string;
  };

export type TransportPayloadOptions = Omit<
  TransportSendOptions,
  "onTextDelta" | "onToolCallStart" | "onToolCallFinish" | "onError"
>;

export type TransportPayload = {
  systemPrompt: string;
  userPrompt: string;
  options?: TransportPayloadOptions;
};

export type TransportOutput = {
  text: string;
  intentRequestText: string;
  finishReason: FinishReason;
  usage: LanguageModelUsage;
  totalUsage: LanguageModelUsage;
  stepCount: number;
  toolCallCount: number;
  toolResultCount: number;
  responseMessageCount: number;
  pendingToolCalls: TransportPendingToolCall[];
};

export type TransportTextPort = {
  generateText: (
    systemPrompt: string,
    userPrompt: string,
    options?: TransportGenerateTextOptions,
  ) => Promise<string>;
  generateObject: <TOutput>(
    systemPrompt: string,
    userPrompt: string,
    options: TransportGenerateObjectOptions<TOutput>,
  ) => Promise<TOutput>;
};
