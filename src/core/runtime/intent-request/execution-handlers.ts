/**
 * intent-request/execution-handlers.ts
 * @description
 * 收口 Intent Request 的具体执行处理器。
 *
 * 这个文件负责把某一种结构化请求映射成实际执行动作，
 * 但不负责整轮请求列表的串行调度。
 */
import type {
  FollowUpIntentRequest,
  FollowUpWithToolsIntentRequest,
  IntentRequest,
  LoadMemoryIntentRequest,
  MemoryOutput,
  MemoryScope,
  PrepareConversationIntentRequest,
  SaveMemoryIntentRequest,
  SearchMemoryIntentRequest,
  UnloadMemoryIntentRequest,
  UpdateMemoryIntentRequest,
} from "@/types";
import { IntentRequestType } from "@/types";
import { TaskState, type TaskItem } from "@/types/task";
import { isEmpty } from "radashi";
import { createRuntimeMemoryItem } from "../memory-item";
import {
  buildFollowUpTask,
  buildFollowUpWithToolsTask,
  buildFormalConversationTask,
  buildRepeatedSearchClosureTask,
  resolveMemoryScope,
} from "./execution-helpers";
import type {
  IntentRequestExecutionResult,
  RuntimeIntentRequestExecutionContext,
} from "./types";

/* ==================== */
/* Memory Requests      */
/* ==================== */

const PRELOAD_MEMORY_LIMIT = 3;

const createSearchRuntimeMemoryItems = (
  requestWords: string,
  outputs: ReturnType<RuntimeIntentRequestExecutionContext["memory"]["searchMemory"]>,
) => {
  return outputs.map((output) => {
    return createRuntimeMemoryItem(output, {
      retrieval: {
        mode: "context",
        relevance: output.retrieval.relevance,
        reason: `Loaded runtime context from search ${requestWords}`,
      },
    });
  });
};

const createKeyRuntimeMemoryItems = (
  memoryKey: string,
  outputs: MemoryOutput[],
) => {
  return outputs.map((output) => {
    return createRuntimeMemoryItem(output, {
      retrieval: {
        mode: "context",
        relevance: output.retrieval.relevance,
        reason: `Loaded runtime context from key ${memoryKey}`,
      },
    });
  });
};

const processSearchMemoryIntentRequest = (
  request: SearchMemoryIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  const scope = resolveMemoryScope(request.params.scope);
  const words = request.params.words.trim();
  const outputs = context.memory.searchMemory({
    words,
    scope,
    limit: request.params.limit,
  });
  const runtimeOutputs = createSearchRuntimeMemoryItems(words, outputs);

  context.recordMemorySearchResult(scope, {
    words,
    outputs: runtimeOutputs,
    reason: runtimeOutputs.length > 0
      ? `Loaded ${scope} memory for ${words}`
      : `No ${scope} memory matched ${words}`,
  });

  return {
    status: "continue",
  };
};

const processLoadMemoryIntentRequest = (
  request: LoadMemoryIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  const output = context.memory.getMemoryByKey(request.params.key);

  if (!output) {
    return {
      status: "continue",
    };
  }

  context.setMemoryContext(
    output.memory.scope,
    createKeyRuntimeMemoryItems(request.params.key, [output]),
    {
      query: request.params.key,
      reason: `Loaded memory by explicit key ${request.params.key}`,
    },
  );

  return {
    status: "continue",
  };
};

const processSaveMemoryIntentRequest = (
  task: TaskItem,
  request: SaveMemoryIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  const scope = resolveMemoryScope(request.params.scope);
  const saveResult = context.memory.saveMemory({
    text: request.params.text,
    summary: request.params.summary,
    scope,
    source: "assistant",
    source_ref: task.chatId,
    created_by: "core_intent_request",
  });
  const output = context.memory.getMemoryByKey(saveResult.memory_key);

  if (output) {
    context.setMemoryContext(scope, createKeyRuntimeMemoryItems(saveResult.memory_key, [output]), {
      query: saveResult.memory_key,
      reason: `Saved memory as ${saveResult.memory_key}`,
    });
  }

  return {
    status: "continue",
  };
};

const processUpdateMemoryIntentRequest = (
  request: UpdateMemoryIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  context.memory.updateMemory({
    memory_key: request.params.key,
    ...(request.params.text ? { text: request.params.text } : {}),
    ...(request.params.summary ? { summary: request.params.summary } : {}),
    created_by: "core_intent_request",
  });
  const output = context.memory.getMemoryByKey(request.params.key);
  const loadedScope = context.getLoadedMemoryScopeByKey(request.params.key);

  if (output && loadedScope) {
    context.setMemoryContext(loadedScope, createKeyRuntimeMemoryItems(request.params.key, [output]), {
      query: request.params.key,
      reason: `Updated memory ${request.params.key}`,
    });
  }

  return {
    status: "continue",
  };
};

const processUnloadMemoryIntentRequest = (
  request: UnloadMemoryIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  context.unloadMemoryContextByKey(request.params.key);

  return {
    status: "continue",
  };
};

/* ==================== */
/* Conversation Request */
/* ==================== */

const processPrepareConversationIntentRequest = (
  task: TaskItem,
  request: PrepareConversationIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  context.setIntentPolicy(task.sessionId, {
    sessionId: task.sessionId,
    acceptedIntentType: request.params.acceptedIntentType,
    preloadMemory: request.params.preloadMemory,
    memoryQuery: request.params.memoryQuery,
    allowMemorySave: request.params.allowMemorySave,
    maxFollowUpRounds: request.params.maxFollowUpRounds,
    promptVariant: request.params.promptVariant,
    predictionTrust: request.params.predictionTrust,
    reasons: [],
  });

  if (request.params.preloadMemory && !isEmpty(request.params.memoryQuery)) {
    const scope = "long" as MemoryScope;
    const memoryContext = context.getMemoryContext(scope);

    if (
      memoryContext.status === "idle" ||
      memoryContext.query !== request.params.memoryQuery
    ) {
      const outputs = context.memory.searchMemory({
        words: request.params.memoryQuery,
        scope,
        limit: PRELOAD_MEMORY_LIMIT,
      });
      const runtimeOutputs = createSearchRuntimeMemoryItems(
        request.params.memoryQuery,
        outputs,
      );

      context.recordMemorySearchResult(scope, {
        words: request.params.memoryQuery,
        outputs: runtimeOutputs,
        reason: runtimeOutputs.length > 0
          ? `Loaded ${scope} memory from prepare conversation query ${request.params.memoryQuery}`
          : `No ${scope} memory matched prepare conversation query ${request.params.memoryQuery}`,
      });
    }
  }

  return {
    status: "stop",
    nextState: TaskState.FOLLOW_UP,
    nextTask: buildFormalConversationTask(task),
  };
};

const processFollowUpIntentRequest = (
  task: TaskItem,
  request: FollowUpIntentRequest,
): IntentRequestExecutionResult => {
  return {
    status: "stop",
    nextState: TaskState.FOLLOW_UP,
    nextTask: buildFollowUpTask(task, request),
  };
};

const processFollowUpWithToolsIntentRequest = (
  task: TaskItem,
  request: FollowUpWithToolsIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  context.setContinuationContext(request.params);

  return {
    status: "stop",
    nextState: TaskState.FOLLOW_UP,
    nextTask: buildFollowUpWithToolsTask(task, request),
  };
};

export const processRepeatedSearchFollowUpIntentRequest = (
  task: TaskItem,
  searchRequest: SearchMemoryIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  const scope = resolveMemoryScope(searchRequest.params.scope);
  const memoryStatus = context.getMemoryContext(scope).status === "loaded"
    ? "loaded"
    : "empty";

  return {
    status: "stop",
    nextState: TaskState.FOLLOW_UP,
    nextTask: buildRepeatedSearchClosureTask(
      task,
      searchRequest,
      memoryStatus,
      "repeated_search",
    ),
  };
};

export const processSearchMemoryWithoutFollowUpIntentRequest = (
  task: TaskItem,
  searchRequest: SearchMemoryIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  const scope = resolveMemoryScope(searchRequest.params.scope);
  const memoryStatus = context.getMemoryContext(scope).status === "loaded"
    ? "loaded"
    : "empty";

  return {
    status: "stop",
    nextState: TaskState.FOLLOW_UP,
    nextTask: buildRepeatedSearchClosureTask(
      task,
      searchRequest,
      memoryStatus,
      "missing_follow_up",
    ),
  };
};

/* ==================== */
/* Request Router       */
/* ==================== */

export const processIntentRequest = (
  task: TaskItem,
  request: IntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  switch (request.request) {
    case IntentRequestType.PREPARE_CONVERSATION:
      return processPrepareConversationIntentRequest(task, request, context);
    case IntentRequestType.SEARCH_MEMORY:
      return processSearchMemoryIntentRequest(request, context);
    case IntentRequestType.LOAD_MEMORY:
      return processLoadMemoryIntentRequest(request, context);
    case IntentRequestType.UNLOAD_MEMORY:
      return processUnloadMemoryIntentRequest(request, context);
    case IntentRequestType.SAVE_MEMORY:
      return processSaveMemoryIntentRequest(task, request, context);
    case IntentRequestType.UPDATE_MEMORY:
      return processUpdateMemoryIntentRequest(request, context);
    case IntentRequestType.FOLLOW_UP:
      return processFollowUpIntentRequest(task, request);
    case IntentRequestType.FOLLOW_UP_WITH_TOOLS:
      return processFollowUpWithToolsIntentRequest(task, request, context);
    case IntentRequestType.LOAD_SKILL:
      return {
        status: "continue",
      };
  }
};
