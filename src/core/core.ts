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
  type MemoryScope,
  type SaveMemoryIntentRequest,
  type SearchMemoryIntentRequest,
} from "@/types";

import { isEmpty, isNumber, sleep } from "radashi";
import type { MemoryService } from "@/services";
import { TaskQueue } from "./queue";
import { Runtime } from "./runtime";
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

  #resolveMemoryScope(scope?: string): MemoryScope {
    return (scope ?? "long") as MemoryScope;
  }

  /**
   * 判断当前 SEARCH_MEMORY 是否只是重复搜索同一条未命中的 query。
   * @description
   * 只有 internal FOLLOW_UP 轮次且 Runtime 已明确记录为 empty 时才拦截，
   * 这样首次 miss 仍然可以进入一轮解释性 FOLLOW_UP，避免过早截断正常回答。
   */
  #shouldSkipRepeatedEmptySearchMemory(
    task: TaskItem,
    request: SearchMemoryIntentRequest,
  ) {
    if (task.source !== TaskSource.INTERNAL) {
      return false;
    }

    const scope = this.#resolveMemoryScope(request.params.scope);
    const memoryContext = this.#runtime.getMemoryContext(scope);

    return (
      memoryContext.status === "empty"
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
      case IntentRequestType.SAVE_MEMORY:
        return this.#processSaveMemoryIntentRequest(task, request);
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
    let shouldSkipNextFollowUp = false;

    for (const request of requests) {
      if (
        request.request === IntentRequestType.SEARCH_MEMORY
        && this.#shouldSkipRepeatedEmptySearchMemory(task, request)
      ) {
        shouldSkipNextFollowUp = true;
        continue;
      }

      if (shouldSkipNextFollowUp && request.request === IntentRequestType.FOLLOW_UP) {
        shouldSkipNextFollowUp = false;
        continue;
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
      const [systemPrompt, userPrompt] = await this.#runtime.exportPrompts();
      let hasSyncedProcessingState = false;

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
          this.#emitChatChunkAppendedEvent(task, textDelta);
        },
      });

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

      this.#taskQueue.updateTask(
        task.id,
        { state: TaskState.COMPLETE },
        { shouldSyncEvent: false },
      );

      // FOLLOW_UP 链路下，最终完成消息要优先使用 Runtime 已累计的可见输出，
      // 避免 complete 事件只带最后一轮 transport 返回的那部分文本。
      const completedMessage = this.#runtime.getAccumulatedAssistantOutput();

      const payload: ChatCompletedEventPayload = {
        sessionId: task.sessionId,
        chatId: task.chatId,
        status: ChatStatus.COMPLETE,
        message: {
          createdAt: Date.now(),
          data: isEmpty(completedMessage) ? result.text : completedMessage,
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
