/**
 * 类型统一出口
 * @description
 * 对外暴露稳定的类型入口，避免业务代码跨多个类型文件来回跳转。
 * 这里按领域分组导出，阅读顺序保持为：
 * primitive -> task -> chat -> session -> event -> intent-request
 */

/* ==================== */
/* Primitive Types      */
/* ==================== */

export type {
  UUID,
  ISOTimeString,
  EmptyString,
} from "./primitive";

/* ==================== */
/* Task Types           */
/* ==================== */

export {
  TaskSource,
  TaskState,
} from "./task";

export type {
  TaskPayload,
  TaskChannel,
  RawTaskItem,
  TaskItemInput,
  TaskItem,
  TaskItems,
} from "./task";

/* ==================== */
/* Chat Types           */
/* ==================== */

export {
  ChatStatus,
} from "./chat";

export type {
  ChatChunk,
  ChatMessage,
  WaitingChat,
  PendingChat,
  StreamingChat,
  CompletedChat,
  FailedChat,
  Chat,
} from "./chat";

/* ==================== */
/* Session Types        */
/* ==================== */

export {
  SessionStatus,
} from "./session";

export type {
  Session,
  ArchivedSession,
  ChatPollResult,
} from "./session";

/* ==================== */
/* Event Types          */
/* ==================== */

export {
  ChatEvents,
} from "./event";

export type {
  ChatEnqueuedEventPayload,
  ChatActivatedEventPayload,
  ChatChunkAppendedEventPayload,
  ChatCompletedEventPayload,
  ChatFailedEventPayload,
} from "./event";

/* ==================== */
/* Intent Request Types */
/* ==================== */

export type {
  ChatSubmissionBody,
  IntentRequest,
  SearchMemoryIntentRequestParams,
  SaveMemoryIntentRequestParams,
  LoadSkillIntentRequestParams,
  FollowUpIntentRequestParams,
  SearchMemoryIntentRequest,
  SaveMemoryIntentRequest,
  LoadSkillIntentRequest,
  FollowUpIntentRequest,
} from "./intent-request";

export {
  IntentRequestType,
  IntentRequestMemoryScope,
  INTENT_REQUEST_TYPES,
  INTENT_REQUEST_MEMORY_SCOPES,
  isIntentRequestType,
  isIntentRequestMemoryScope,
} from "./intent-request";

/* ==================== */
/* Config Types         */
/* ==================== */

export {
  DefaultConfig,
  SUPPORTED_PROVIDERS,
  SUPPORTED_PROVIDER_MODELS,
  isProviderID,
  isConfigProviderModelID,
} from "./config";

export type {
  ProviderID,
  DeepseekModelID,
  OpenAIModelID,
  OpenAICompatibleModelID,
  ProviderModelMap,
  ProviderModelID,
  ConfigProviderModelID,
  ProviderDefinition,
  ProvidersConfigScheme,
  ProviderProfiles,
  ProviderProfileLevel,
  SelectedProviderModel,
  ParsedProviderModel,
  GatewayChannelScheme,
  GatewayConfigScheme,
  ConfigFileScheme,
} from "./config";
