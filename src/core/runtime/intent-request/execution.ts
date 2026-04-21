import { buildInternalTaskItem } from "@/libs";
import type { MemoryService } from "@/services";
import type {
  FollowUpIntentRequest,
  IntentRequest,
  LoadMemoryIntentRequest,
  MemoryScope,
  PrepareConversationIntentRequest,
  RuntimeMemoryOutput,
  SaveMemoryIntentRequest,
  SearchMemoryIntentRequest,
  UnloadMemoryIntentRequest,
  UpdateMemoryIntentRequest,
} from "@/types";
import { IntentRequestType } from "@/types";
import { TaskSource, TaskState, TaskWorkflow, type TaskItem } from "@/types/task";
import { isEmpty, isNumber } from "radashi";
import type { IntentExecutionPolicy } from "../user-intent";

export type IntentRequestExecutionResult =
  | {
      status: "continue";
    }
  | {
      status: "stop";
      nextState?: TaskState;
      nextTask?: TaskItem;
    };

type RuntimeIntentRequestExecutionContext = {
  memory: MemoryService;
  getMemoryContext: (
    scope: MemoryScope,
  ) => {
    status: "idle" | "loaded" | "empty";
    query: string;
  };
  recordMemorySearchResult: (
    scope: MemoryScope,
    options: {
      words: string;
      output: RuntimeMemoryOutput | null;
      reason?: string;
    },
  ) => void;
  setMemoryContext: (
    scope: MemoryScope,
    output: RuntimeMemoryOutput,
    options?: {
      query?: string;
      reason?: string;
    },
  ) => void;
  getLoadedMemoryScopeByKey: (memoryKey: string) => MemoryScope | null;
  unloadMemoryContextByKey: (memoryKey: string) => boolean;
  setIntentPolicy: (sessionId: string, policy: Omit<IntentExecutionPolicy, "updatedAt">) => void;
};

const resolveMemoryScope = (scope?: string): MemoryScope => {
  return (scope ?? "long") as MemoryScope;
};

const parseTaskChainRound = (task: TaskItem) => {
  const chainRound = task.chain_round;

  if (!isNumber(chainRound) || chainRound < 1) {
    return 0;
  }

  return chainRound;
};

const buildFollowUpTask = (
  task: TaskItem,
  request: FollowUpIntentRequest,
) => {
  const nextChainRound = parseTaskChainRound(task) + 1;
  const followUpIntent = isEmpty(request.intent)
    ? "请基于当前 FollowUp 上下文继续当前回答，不要重复已经输出的内容。"
    : request.intent;

  return buildInternalTaskItem({
    sessionId: request.params.sessionId,
    chatId: request.params.chatId,
    chainId: task.chainId,
    parentId: task.id,
    chain_round: nextChainRound,
    priority: 1,
    eventTarget: task.eventTarget,
    channel: task.channel,
    payload: [
      {
        type: "text",
        data: followUpIntent,
      },
    ],
  });
};

const buildRepeatedSearchClosureTask = (
  task: TaskItem,
  searchRequest: SearchMemoryIntentRequest,
  memoryStatus: "loaded" | "empty",
  reason: "repeated_search" | "missing_follow_up",
) => {
  const nextChainRound = parseTaskChainRound(task) + 1;
  const summary = memoryStatus === "loaded"
    ? "系统已经完成该记忆搜索，结果已写入 <Memory>。"
    : "系统已经完成该记忆搜索，但 <Memory> 没有命中。";
  const triggerReason = reason === "repeated_search"
    ? "重复搜索已被 Core 拦截。"
    : "本轮 SEARCH_MEMORY 已执行，但模型没有提交 FOLLOW_UP。";

  return buildInternalTaskItem({
    sessionId: task.sessionId,
    chatId: task.chatId,
    chainId: task.chainId,
    parentId: task.id,
    chain_round: nextChainRound,
    priority: 1,
    eventTarget: task.eventTarget,
    channel: task.channel,
    payload: [
      {
        type: "text",
        data: [
          `${triggerReason}${summary}`,
          `当前搜索 query = ${searchRequest.params.words.trim()}`,
          "不要再次发起 SEARCH_MEMORY 或 FOLLOW_UP。",
          "请直接基于当前 <Memory>、OriginalUserInput 和已累计输出给出最终回答，不要重复已经输出的内容。",
        ].join("\n"),
      },
    ],
  });
};

const shouldSkipRepeatedSearchMemory = (
  task: TaskItem,
  request: SearchMemoryIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
) => {
  if (task.source !== TaskSource.INTERNAL) {
    return false;
  }

  const scope = resolveMemoryScope(request.params.scope);
  const memoryContext = context.getMemoryContext(scope);

  return (
    memoryContext.status !== "idle" &&
    memoryContext.query === request.params.words.trim()
  );
};

const processSearchMemoryIntentRequest = (
  request: SearchMemoryIntentRequest,
  context: RuntimeIntentRequestExecutionContext,
): IntentRequestExecutionResult => {
  const scope = resolveMemoryScope(request.params.scope);
  const words = request.params.words.trim();
  const output = context.memory.retrieveRuntimeContext({
    words,
    scope,
  });

  context.recordMemorySearchResult(scope, {
    words,
    output,
    reason: output
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

  const runtimeOutput = context.memory.retrieveRuntimeContext({
    memory_key: request.params.key,
  });

  if (runtimeOutput) {
    context.setMemoryContext(output.memory.scope, runtimeOutput, {
      query: request.params.key,
      reason: `Loaded memory by explicit key ${request.params.key}`,
    });
  }

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
  const output = context.memory.retrieveRuntimeContext({
    memory_key: saveResult.memory_key,
    scope,
  });

  if (output) {
    context.setMemoryContext(scope, output, {
      query: saveResult.memory_key,
      reason: `Saved memory as ${saveResult.memory_key}`,
    });
  }

  return {
    status: "continue",
  };
};

const buildFormalConversationTask = (task: TaskItem) => {
  return buildInternalTaskItem({
    sessionId: task.sessionId,
    chatId: task.chatId,
    chainId: task.chainId,
    parentId: task.id,
    priority: 1,
    eventTarget: task.eventTarget,
    channel: task.channel,
    payload: task.payload,
    workflow: TaskWorkflow.FORMAL_CONVERSATION,
  });
};

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

  if (
    request.params.preloadMemory &&
    !isEmpty(request.params.memoryQuery)
  ) {
    const scope = "long" as MemoryScope;
    const memoryContext = context.getMemoryContext(scope);

    if (
      memoryContext.status === "idle" ||
      memoryContext.query !== request.params.memoryQuery
    ) {
      const output = context.memory.retrieveRuntimeContext({
        words: request.params.memoryQuery,
        scope,
      });

      context.recordMemorySearchResult(scope, {
        words: request.params.memoryQuery,
        output,
        reason: output
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
  const runtimeOutput = context.memory.retrieveRuntimeContext({
    memory_key: request.params.key,
  });
  const loadedScope = context.getLoadedMemoryScopeByKey(request.params.key);

  if (runtimeOutput && loadedScope) {
    context.setMemoryContext(loadedScope, runtimeOutput, {
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

const processRepeatedSearchFollowUpIntentRequest = (
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

const processSearchMemoryWithoutFollowUpIntentRequest = (
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

const processIntentRequest = (
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
    case IntentRequestType.LOAD_SKILL:
      return {
        status: "continue",
      };
  }
};

export const executeIntentRequests = async (
  task: TaskItem,
  requests: IntentRequest[],
  context: RuntimeIntentRequestExecutionContext,
) => {
  let repeatedSearchRequest: SearchMemoryIntentRequest | null = null;
  let lastSearchRequest: SearchMemoryIntentRequest | null = null;
  let hasFollowUpRequest = false;

  for (const request of requests) {
    if (
      request.request === IntentRequestType.SEARCH_MEMORY &&
      shouldSkipRepeatedSearchMemory(task, request, context)
    ) {
      repeatedSearchRequest = request;
      lastSearchRequest = request;
      continue;
    }

    if (
      repeatedSearchRequest &&
      request.request === IntentRequestType.FOLLOW_UP
    ) {
      hasFollowUpRequest = true;
      return processRepeatedSearchFollowUpIntentRequest(
        task,
        repeatedSearchRequest,
        context,
      );
    }

    if (request.request === IntentRequestType.SEARCH_MEMORY) {
      lastSearchRequest = request;
    }

    if (request.request === IntentRequestType.FOLLOW_UP) {
      hasFollowUpRequest = true;
    }

    const processResult = processIntentRequest(task, request, context);

    if (processResult.status === "stop") {
      return processResult;
    }
  }

  const pendingSearchRequest = repeatedSearchRequest ?? lastSearchRequest;

  if (pendingSearchRequest && !hasFollowUpRequest) {
    return processSearchMemoryWithoutFollowUpIntentRequest(
      task,
      pendingSearchRequest,
      context,
    );
  }

  return {
    status: "continue",
  } satisfies IntentRequestExecutionResult;
};
