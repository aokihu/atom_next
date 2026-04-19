import { TaskSource, type TaskItem } from "@/types/task";
import type { ServiceManager } from "@/libs/service-manage";
import { buildInternalTaskItem } from "@/libs";
import {
  ChatEvents,
  type ChatChunkAppendedEventPayload,
  type ChatFailedEventPayload,
  type ChatCompletedEventPayload,
} from "@/types/event";
import { ChatStatus } from "@/types/chat";
import {
  IntentRequestType,
  TaskState,
  type FollowUpIntentRequest,
  type IntentRequest,
  type LoadMemoryIntentRequest,
  type MemoryScope,
  type SaveMemoryIntentRequest,
  type SearchMemoryIntentRequest,
  type UnloadMemoryIntentRequest,
  type UpdateMemoryIntentRequest,
} from "@/types";

import { isEmpty, isNumber, sleep } from "radashi";
import type { MemoryService } from "@/services";
import { TaskQueue } from "./queue";
import { parseIntentPredictionText, Runtime } from "./runtime";
import { Transport } from "./transport";

type IntentRequestProcessResult =
  | {
      status: "continue";
    }
  | {
      status: "stop";
      nextState?: TaskState;
      nextTask?: TaskItem;
    };

export class Core {
  static readonly ACTIVATE_TASK_DELAY = 1000;

  #serviceManager: ServiceManager;
  #taskQueue: TaskQueue;
  #runtime: Runtime;
  #transport: Transport;

  #activedTask: TaskItem | undefined = undefined; // 当前激活的任务
  #activeTimer: NodeJS.Timeout | null = null; // 定时检查激活任务计时器

  constructor(serviceManager: ServiceManager) {
    this.#serviceManager = serviceManager;
    this.#taskQueue = new TaskQueue();
    this.#runtime = new Runtime(this.#serviceManager);
    this.#transport = new Transport(this.#serviceManager);
  }

  /* ==================== */
  /*        Private       */
  /* ==================== */

  /**
   * 空任务循环
   * @description 当队列中没有任何任务的时候执行该循环
   */
  async #emptyRunloop() {
    await sleep(500);
    this.runloop();
  }

  #getMemoryService() {
    const memory = this.#serviceManager.getService<MemoryService>("memory");

    if (!memory) {
      throw new Error("Memory service not found");
    }

    return memory;
  }

  /**
   * 读取当前任务的内部续跑轮次。
   * @description
   * 外部任务不带 chain_round，因此默认从 0 开始，
   * 第一次派生 FOLLOW_UP 内部任务时再递增到 1。
   */
  #parseTaskChainRound(task: TaskItem) {
    const chainRound = (
      task as TaskItem & {
        chain_round?: number;
      }
    ).chain_round;

    if (!isNumber(chainRound) || chainRound < 1) {
      return 0;
    }

    return chainRound;
  }

  /**
   * 构造 FOLLOW_UP 内部任务。
   * @description
   * 内部任务只携带最小续跑提示，
   * 真实上下文由 Runtime Context 负责维护和注入。
   */
  #buildFollowUpTask(task: TaskItem, request: FollowUpIntentRequest) {
    const nextChainRound = this.#parseTaskChainRound(task) + 1;
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
  }

  /**
   * 构造“重复搜索后的强制收束”内部任务。
   * @description
   * 当 internal 续跑轮次里重复发起同一条 SEARCH_MEMORY 时，
   * 说明模型没有消费当前 <Memory>，而是在重复“先搜索再回答”的模式。
   * 这里派生一条更强约束的内部任务，明确禁止再次搜索，
   * 要求直接基于当前 <Memory> 收束为最终回答。
   */
  #buildRepeatedSearchClosureTask(
    task: TaskItem,
    searchRequest: SearchMemoryIntentRequest,
    reason: "repeated_search" | "missing_follow_up",
  ) {
    const nextChainRound = this.#parseTaskChainRound(task) + 1;
    const scope = this.#resolveMemoryScope(searchRequest.params.scope);
    const memoryContext = this.#runtime.getMemoryContext(scope);
    const summary =
      memoryContext.status === "loaded"
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
  }

  /**
   * 推进任务到 PROCESSING 状态。
   * @description
   * 这里只负责第一次进入流式阶段时推进内部状态，
   * 不额外发出队列生命周期事件，避免和 chunk 事件职责重叠。
   * @param task 当前正在执行的任务
   * @param hasSyncedProcessingState 标记当前任务是否已经同步过一次 PROCESSING 状态。
   *                                 onTextDelta 会被连续调用，因此这里用这个布尔值
   *                                 避免在每个 chunk 到来时重复更新同一个状态。
   * @returns 返回最新的 PROCESSING 状态标记，调用方用它继续维护热路径中的局部状态。
   */
  #syncTaskProcessingState(task: TaskItem, hasSyncedProcessingState: boolean) {
    if (hasSyncedProcessingState) {
      return true;
    }

    this.#taskQueue.updateTask(
      task.id,
      {
        state: TaskState.PROCESSING,
      },
      {
        shouldSyncEvent: false,
      },
    );

    return true;
  }

  /**
   * 发送流式 chunk 事件。
   * @description
   * 第一条 chunk 到来就代表已经进入流式输出阶段，
   * 外部通过 CHAT_CHUNK_APPENDED 即可同步当前可见内容。
   */
  #emitChatChunkAppendedEvent(task: TaskItem, textDelta: string) {
    const payload: ChatChunkAppendedEventPayload = {
      sessionId: task.sessionId,
      chatId: task.chatId,
      status: ChatStatus.PROCESSING,
      chunk: textDelta,
    };

    task.eventTarget?.emit(ChatEvents.CHAT_CHUNK_APPENDED, payload);
  }

  /**
   * 处理单条 FOLLOW_UP 请求。
   * @description
   * FOLLOW_UP 会把当前任务收束为内部续跑链路：
   * 当前任务切到 FOLLOW_UP 状态，并派生下一条内部任务入队。
   */
  #processFollowUpIntentRequest(
    task: TaskItem,
    request: FollowUpIntentRequest,
  ): IntentRequestProcessResult {
    return {
      status: "stop",
      nextState: TaskState.FOLLOW_UP,
      nextTask: this.#buildFollowUpTask(task, request),
    };
  }

  #processRepeatedSearchFollowUpIntentRequest(
    task: TaskItem,
    searchRequest: SearchMemoryIntentRequest,
  ): IntentRequestProcessResult {
    return {
      status: "stop",
      nextState: TaskState.FOLLOW_UP,
      nextTask: this.#buildRepeatedSearchClosureTask(
        task,
        searchRequest,
        "repeated_search",
      ),
    };
  }

  #processSearchMemoryWithoutFollowUpIntentRequest(
    task: TaskItem,
    searchRequest: SearchMemoryIntentRequest,
  ): IntentRequestProcessResult {
    return {
      status: "stop",
      nextState: TaskState.FOLLOW_UP,
      nextTask: this.#buildRepeatedSearchClosureTask(
        task,
        searchRequest,
        "missing_follow_up",
      ),
    };
  }

  #resolveMemoryScope(scope?: string): MemoryScope {
    return (scope ?? "long") as MemoryScope;
  }

  /**
   * 判断当前 SEARCH_MEMORY 是否只是重复搜索同一条 query。
   * @description
   * internal FOLLOW_UP 轮次里，如果 Runtime 已经持有同 scope + 同 query 的搜索结果，
   * 无论上次结果是 loaded 还是 empty，都不应再次派生同一轮搜索，
   * 否则模型可能在“先搜索再继续”的模式下自循环复读。
   *
   * 首次 external 搜索仍然放行；
   * 只有进入 internal 续跑后，才根据 Runtime 中最近一次搜索快照进行去重拦截。
   */
  #shouldSkipRepeatedSearchMemory(
    task: TaskItem,
    request: SearchMemoryIntentRequest,
  ) {
    if (task.source !== TaskSource.INTERNAL) {
      return false;
    }

    const scope = this.#resolveMemoryScope(request.params.scope);
    const memoryContext = this.#runtime.getMemoryContext(scope);

    return (
      memoryContext.status !== "idle"
      && memoryContext.query === request.params.words.trim()
    );
  }

  #processSearchMemoryIntentRequest(
    request: SearchMemoryIntentRequest,
  ): IntentRequestProcessResult {
    const memory = this.#getMemoryService();
    const scope = this.#resolveMemoryScope(request.params.scope);
    const words = request.params.words.trim();
    const output = memory.retrieveRuntimeContext({
      words,
      scope,
    });

    this.#runtime.recordMemorySearchResult(scope, {
      words,
      output,
      reason: output
        ? `Loaded ${scope} memory for ${words}`
        : `No ${scope} memory matched ${words}`,
    });

    return {
      status: "continue",
    };
  }

  #processLoadMemoryIntentRequest(
    request: LoadMemoryIntentRequest,
  ): IntentRequestProcessResult {
    const memory = this.#getMemoryService();
    const output = memory.getMemoryByKey(request.params.key);

    if (!output) {
      return {
        status: "continue",
      };
    }

    const runtimeOutput = memory.retrieveRuntimeContext({
      memory_key: request.params.key,
    });

    if (runtimeOutput) {
      this.#runtime.setMemoryContext(output.memory.scope, runtimeOutput, {
        query: request.params.key,
        reason: `Loaded memory by explicit key ${request.params.key}`,
      });
    }

    return {
      status: "continue",
    };
  }

  #processSaveMemoryIntentRequest(
    task: TaskItem,
    request: SaveMemoryIntentRequest,
  ): IntentRequestProcessResult {
    const memory = this.#getMemoryService();
    const scope = this.#resolveMemoryScope(request.params.scope);
    const saveResult = memory.saveMemory({
      text: request.params.text,
      summary: request.params.summary,
      scope,
      source: "assistant",
      source_ref: task.chatId,
      created_by: "core_intent_request",
    });
    const output = memory.retrieveRuntimeContext({
      memory_key: saveResult.memory_key,
      scope,
    });

    if (output) {
      this.#runtime.setMemoryContext(scope, output, {
        query: saveResult.memory_key,
        reason: `Saved memory as ${saveResult.memory_key}`,
      });
    }

    return {
      status: "continue",
    };
  }

  #processUpdateMemoryIntentRequest(
    task: TaskItem,
    request: UpdateMemoryIntentRequest,
  ): IntentRequestProcessResult {
    const memory = this.#getMemoryService();
    const output = memory.updateMemory({
      memory_key: request.params.key,
      ...(request.params.text ? { text: request.params.text } : {}),
      ...(request.params.summary ? { summary: request.params.summary } : {}),
      created_by: "core_intent_request",
    });
    const runtimeOutput = memory.retrieveRuntimeContext({
      memory_key: request.params.key,
    });
    const loadedScope = this.#runtime.getLoadedMemoryScopeByKey(request.params.key);

    if (runtimeOutput && loadedScope) {
      this.#runtime.setMemoryContext(loadedScope, runtimeOutput, {
        query: request.params.key,
        reason: `Updated memory ${request.params.key}`,
      });
    }

    return {
      status: "continue",
    };
  }

  #processUnloadMemoryIntentRequest(
    request: UnloadMemoryIntentRequest,
  ): IntentRequestProcessResult {
    this.#runtime.unloadMemoryContextByKey(request.params.key);

    return {
      status: "continue",
    };
  }

  async #predictIntentIfNeeded(task: TaskItem) {
    if (task.source !== TaskSource.EXTERNAL) {
      return;
    }

    const predictionText = await this.#transport.predictIntent(
      this.#runtime.exportIntentPrompt(),
      this.#runtime.exportUserPrompt(),
    );
    const parsedIntent = parseIntentPredictionText(predictionText);

    this.#runtime.setIntentContext({
      sessionId: task.sessionId,
      type: parsedIntent.type,
      needsMemory: parsedIntent.needsMemory,
      needsMemorySave: parsedIntent.needsMemorySave,
      memoryQuery: parsedIntent.memoryQuery,
      confidence: parsedIntent.confidence,
    });
  }

  #hydrateMemoryFromIntent(task: TaskItem) {
    if (task.source !== TaskSource.EXTERNAL) {
      return;
    }

    const intent = this.#runtime.getIntentContext();

    if (!intent.needsMemory || isEmpty(intent.memoryQuery)) {
      return;
    }

    const scope = "long" as MemoryScope;
    const memoryContext = this.#runtime.getMemoryContext(scope);

    if (
      memoryContext.status !== "idle"
      && memoryContext.query === intent.memoryQuery
    ) {
      return;
    }

    const memory = this.#getMemoryService();
    const output = memory.retrieveRuntimeContext({
      words: intent.memoryQuery,
      scope,
    });

    this.#runtime.recordMemorySearchResult(scope, {
      words: intent.memoryQuery,
      output,
      reason: output
        ? `Loaded ${scope} memory from intent query ${intent.memoryQuery}`
        : `No ${scope} memory matched intent query ${intent.memoryQuery}`,
    });
  }

  /**
   * 处理单条 Intent Request。
   * @description
   * 当前阶段默认串行消费请求。
   * 只有真正改变任务流转的请求才会返回 stop，其余请求先保持最小 continue 行为。
   */
  #processIntentRequest(
    task: TaskItem,
    request: IntentRequest,
  ): IntentRequestProcessResult {
    switch (request.request) {
      case IntentRequestType.SEARCH_MEMORY:
        return this.#processSearchMemoryIntentRequest(request);
      case IntentRequestType.LOAD_MEMORY:
        return this.#processLoadMemoryIntentRequest(request);
      case IntentRequestType.UNLOAD_MEMORY:
        return this.#processUnloadMemoryIntentRequest(request);
      case IntentRequestType.SAVE_MEMORY:
        return this.#processSaveMemoryIntentRequest(task, request);
      case IntentRequestType.UPDATE_MEMORY:
        return this.#processUpdateMemoryIntentRequest(task, request);
      case IntentRequestType.FOLLOW_UP:
        return this.#processFollowUpIntentRequest(task, request);
      case IntentRequestType.LOAD_SKILL:
        return {
          status: "continue",
        };
    }
  }

  /**
   * 应用单条 Intent Request 的处理结果。
   * @description
   * 这里统一负责把 handler 的结果映射到任务状态和队列变更，
   * 避免在主流程里散落多个 updateTask / addTask 分支。
   */
  async #applyIntentRequestProcessResult(
    task: TaskItem,
    result: IntentRequestProcessResult,
  ) {
    if (result.status === "continue") {
      return false;
    }

    if (result.nextState) {
      this.#taskQueue.updateTask(
        task.id,
        { state: result.nextState },
        { shouldSyncEvent: false },
      );
    }

    if (result.nextTask) {
      await this.#taskQueue.addTask(result.nextTask);
    }

    return true;
  }

  /**
   * 串行处理安全通过的 Intent Request。
   * @description
   * 当前阶段固定按数组顺序串行消费。
   * 一旦某条请求真正改变了任务流转，就停止继续处理后续请求。
   */
  async #processIntentRequests(task: TaskItem, requests: IntentRequest[]) {
    let repeatedSearchRequest: SearchMemoryIntentRequest | null = null;
    let lastSearchRequest: SearchMemoryIntentRequest | null = null;
    let hasFollowUpRequest = false;

    for (const request of requests) {
      if (
        request.request === IntentRequestType.SEARCH_MEMORY
        && this.#shouldSkipRepeatedSearchMemory(task, request)
      ) {
        repeatedSearchRequest = request;
        lastSearchRequest = request;
        continue;
      }

      if (
        repeatedSearchRequest
        && request.request === IntentRequestType.FOLLOW_UP
      ) {
        hasFollowUpRequest = true;
        const processResult = this.#processRepeatedSearchFollowUpIntentRequest(
          task,
          repeatedSearchRequest,
        );
        const shouldStop = await this.#applyIntentRequestProcessResult(
          task,
          processResult,
        );

        if (shouldStop) {
          return true;
        }

        repeatedSearchRequest = null;
        continue;
      }

      if (request.request === IntentRequestType.SEARCH_MEMORY) {
        lastSearchRequest = request;
      }

      if (request.request === IntentRequestType.FOLLOW_UP) {
        hasFollowUpRequest = true;
      }

      const processResult = this.#processIntentRequest(task, request);
      const shouldStop = await this.#applyIntentRequestProcessResult(
        task,
        processResult,
      );

      if (shouldStop) {
        return true;
      }
    }

    const pendingSearchRequest = repeatedSearchRequest ?? lastSearchRequest;

    if (pendingSearchRequest && !hasFollowUpRequest) {
      const processResult = this.#processSearchMemoryWithoutFollowUpIntentRequest(
        task,
        pendingSearchRequest,
      );
      return this.#applyIntentRequestProcessResult(task, processResult);
    }

    return false;
  }

  /**
   * 执行任务流程
   * @description
   * 这里串起一次完整的任务执行链路：
   * 1. 激活队列中的可执行任务
   * 2. 导出 Runtime 生成的 system/user prompt
   * 3. 处理流式输出，并把可见文本持续同步回 Runtime 和外部事件
   * 4. 解析 intentRequestText，必要时派生 FOLLOW_UP 内部任务
   * 5. 在完成或失败时收束最终事件
   */
  async #workflow(shouldContinueRunloop = true) {
    const task = await this.#taskQueue.activateWorkableTask();

    if (!task) {
      if (shouldContinueRunloop) {
        this.runloop();
      }
      return;
    }

    this.#activedTask = task;

    try {
      this.#runtime.currentTask = task;
      await this.#predictIntentIfNeeded(task);
      this.#hydrateMemoryFromIntent(task);
      const [systemPrompt, userPrompt] = await this.#runtime.exportPrompts();
      let hasSyncedProcessingState = false;
      let visibleTextBuffer = "";

      const result = await this.#transport.send(systemPrompt, userPrompt, {
        onTextDelta: (textDelta) => {
          // onTextDelta 只负责热路径串联：
          // 先推进内部执行态，
          // 最后同步到 Runtime 累计输出和外部流式事件。
          hasSyncedProcessingState = this.#syncTaskProcessingState(
            task,
            hasSyncedProcessingState,
          );
          this.#runtime.appendAssistantOutput(textDelta);
          visibleTextBuffer += textDelta;
        },
      });
      this.#runtime.setLastAssistantOutput(result.text);

      // intentRequestText 只承载 LLM 在隐藏请求区输出的指令文本，
      // 这里统一交给 Runtime 做识别和安全校验，Core 只消费最终结果。
      const intentRequestResult = this.#runtime.parseLLMRequest(
        result.intentRequestText,
      );

      const shouldStopCompletion = await this.#processIntentRequests(
        task,
        intentRequestResult.safeRequests,
      );

      if (shouldStopCompletion) {
        return;
      }

      if (!isEmpty(visibleTextBuffer)) {
        this.#emitChatChunkAppendedEvent(task, visibleTextBuffer);
      }

      this.#taskQueue.updateTask(
        task.id,
        { state: TaskState.COMPLETE },
        { shouldSyncEvent: false },
      );

      // FOLLOW_UP 链路下，最终完成消息要优先使用 Runtime 已累计的可见输出，
      // 避免 complete 事件只带最后一轮 transport 返回的那部分文本。
      const completedMessage = this.#runtime.getLastAssistantOutput();
      const finalMessage = isEmpty(completedMessage)
        ? this.#runtime.getAccumulatedAssistantOutput() || result.text
        : completedMessage;

      if (task.source === TaskSource.EXTERNAL) {
        this.#runtime.commitSessionTurn(
          this.#runtime.getCurrentChatOriginalUserInput(),
          finalMessage,
        );
      }

      const payload: ChatCompletedEventPayload = {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: ChatStatus.COMPLETE,
        message: {
          createdAt: Date.now(),
          data: finalMessage,
        },
      };

      task.eventTarget?.emit(ChatEvents.CHAT_COMPLETED, payload);
    } catch (error) {
      this.#taskQueue.updateTask(
        task.id,
        { state: TaskState.FAILED },
        { shouldSyncEvent: false },
      );

      const payload: ChatFailedEventPayload = {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: ChatStatus.FAILED,
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };

      task.eventTarget?.emit(ChatEvents.CHAT_FAILED, payload);
    } finally {
      this.#activedTask = undefined;
      if (shouldContinueRunloop) {
        this.runloop();
      }
    }
  }

  /* ==================== */
  /*   Public Methods     */
  /* ==================== */

  async runloop() {
    if (this.#taskQueue.isEmpty) {
      this.#emptyRunloop();
    } else {
      this.#workflow();
    }
  }

  /**
   * 只执行一轮任务流程。
   * @description
   * 测试和受控调用场景下使用，避免自动进入持续 runloop。
   */
  async runOnce() {
    if (this.#taskQueue.isEmpty) {
      return;
    }

    await this.#workflow(false);
  }

  /**
   * 向内核添加任务,这个任务由buildTasl
   * @param task
   */
  async addTask(task: TaskItem) {
    await this.#taskQueue.addTask(task);
  }
}
