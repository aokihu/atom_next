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
  TaskWorkflow,
} from "./task";

export type {
  TaskPayload,
  TaskChannel,
  RawTaskItem,
  InternalTaskItemInput,
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
  ChatOutputUpdatedEventPayload,
  ChatCompletedEventPayload,
  ChatFailedEventPayload,
} from "./event";

/* ==================== */
/* Intent Request Types */
/* ==================== */

export type {
  ChatSubmissionBody,
  IntentRequest,
  PrepareConversationIntentRequestParams,
  SearchMemoryIntentRequestParams,
  LoadMemoryIntentRequestParams,
  UnloadMemoryIntentRequestParams,
  SaveMemoryIntentRequestParams,
  UpdateMemoryIntentRequestParams,
  LoadSkillIntentRequestParams,
  FollowUpIntentRequestParams,
  FollowUpWithToolsIntentRequestParams,
  FollowUpWithToolsFinishedIntentRequestParams,
  FollowUpWithToolsEndIntentRequestParams,
  FollowUpWithToolsEndReasonCode,
  PrepareConversationIntentRequest,
  SearchMemoryIntentRequest,
  LoadMemoryIntentRequest,
  UnloadMemoryIntentRequest,
  SaveMemoryIntentRequest,
  UpdateMemoryIntentRequest,
  LoadSkillIntentRequest,
  FollowUpIntentRequest,
  FollowUpWithToolsIntentRequest,
  FollowUpWithToolsFinishedIntentRequest,
  FollowUpWithToolsEndIntentRequest,
  IntentRequestSafetyContext,
  RejectedIntentRequest,
  IntentRequestSafetyResult,
  IntentRequestDispatchResult,
  IntentRequestHandleResult,
  PrepareConversationIntentType,
  PrepareConversationPromptVariant,
  PrepareConversationPredictionTrust,
} from "./intent-request";

export {
  IntentRequestType,
  IntentRequestSource,
  IntentRequestMemoryScope,
  INTENT_REQUEST_MEMORY_UNLOAD_REASONS,
  IntentRequestSafetyIssueCode,
  IntentRequestDispatchStatus,
  INTENT_REQUEST_TYPES,
  INTENT_REQUEST_SOURCES,
  INTENT_REQUEST_MEMORY_SCOPES,
  PREPARE_CONVERSATION_INTENT_TYPES,
  PREPARE_CONVERSATION_PROMPT_VARIANTS,
  PREPARE_CONVERSATION_PREDICTION_TRUST,
  FOLLOW_UP_WITH_TOOLS_END_REASON_CODES,
  isIntentRequestType,
  isIntentRequestMemoryScope,
  isIntentRequestMemoryUnloadReason,
  isFollowUpWithToolsEndReasonCode,
} from "./intent-request";

/* ==================== */
/* Memory Types         */
/* ==================== */

export type {
  MemoryScope,
  MemoryType,
  MemorySource,
  MemoryStatus,
  LinkType,
  SaveMemoryDecision,
  MemoryRetrievalMode,
  MemoryNode,
  LinkNode,
  MemoryEvent,
  SaveMemoryLinkInput,
  SaveMemoryInput,
  SearchMemoryInput,
  UpdateMemoryInput,
  MarkMemoryStatusInput,
  MemoryRetrieval,
  RelatedMemoryLink,
  MemoryOutput,
  SaveMemoryResult,
  LinkScoreRecalculationResult,
  CleanupMemoriesResult,
  MergeMemoriesResult,
} from "./memory";

export {
  MEMORY_SCOPES,
  MEMORY_TYPES,
  MEMORY_SOURCES,
  MEMORY_STATUSES,
  LINK_TYPES,
  SAVE_MEMORY_DECISIONS,
  MEMORY_RETRIEVAL_MODES,
} from "./memory";

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
