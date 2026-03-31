/**
 * API Server Class
 * @class APIServer
 * @description 提供内核与外部通讯的接口
 *
 */

import type { BunRequest } from "bun";
import type {
  ChatActivatedEventPayload,
  ChatChunkAppendedEventPayload,
  ChatCompletedEventPayload,
  ChatEnqueuedEventPayload,
  ChatFailedEventPayload,
  SubmitChatRequestBody,
} from "@/types/api";
import { ChatEvents, ChatStatus } from "@/types/api";
import { EventEmitter } from "node:events";
import { tryit } from "radashi";
import { ServiceManager } from "@/libs/service-manage";
import { Core } from "@/core";
import { buildError, buildTaskItem, ErrorCause, hasErrorCause } from "@/libs";
import { SessionManager } from "./session";
import { startServer } from "./server";
import { parseSubmitChatBody } from "./utils/submit-chat";

export class APIServer extends EventEmitter {
  /* ==================== 私有属性 ==================== */

  #core: Core; // 内核对象
  #serviceManager: ServiceManager; // 服务管理器
  #sessionManager: SessionManager; // Session管理器
  #server: ReturnType<typeof Bun.serve> | undefined; // API HTTP 服务器

  /* ==================== 构造函数 ==================== */

  constructor(core: Core, serviceManager: ServiceManager) {
    super();

    this.#core = core;
    this.#serviceManager = serviceManager;
    this.#sessionManager = new SessionManager(this.#serviceManager);

    /* --- 设置监听事件 --- */
    this.addListener(ChatEvents.CHAT_ENQUEUED, (payload) => {
      void this.#syncChatEnqueued(payload as ChatEnqueuedEventPayload);
    });
    this.addListener(ChatEvents.CHAT_ACTIVATED, (payload) => {
      void this.#syncChatActivated(payload as ChatActivatedEventPayload);
    });
    this.addListener(ChatEvents.CHAT_CHUNK_APPENDED, (payload) => {
      void this.#syncChatChunkAppended(payload as ChatChunkAppendedEventPayload);
    });
    this.addListener(ChatEvents.CHAT_COMPLETED, (payload) => {
      void this.#syncChatCompleted(payload as ChatCompletedEventPayload);
    });
    this.addListener(ChatEvents.CHAT_FAILED, (payload) => {
      void this.#syncChatFailed(payload as ChatFailedEventPayload);
    });
  }

  /* ==================== 私有方法 ==================== */

  /**
   * 启动API HTTP服务器
   * @private
   * @param port 要监听的端口，未指定时自动查找可用端口
   * @returns 服务器的地址和端口号
   */
  async #start(port?: number): Promise<{
    host: string;
    port: number;
  }> {
    const { server, host, port: listenPort } = await startServer(this, port);
    this.#server = server;
    return { host, port: listenPort };
  }

  /**
   * 转换为JSON响应
   * @private
   */
  #toJsonResponse(body: unknown, status = 200) {
    return Response.json(body, { status });
  }

  /**
   * 转换为400错误响应
   * @private
   */
  #toBadRequestResponse(message: string) {
    return this.#toJsonResponse({ error: message }, 400);
  }

  /**
   * 解析提交聊天请求
   * @private
   */
  async #parseSubmitChatRequest(
    request: BunRequest,
  ): Promise<SubmitChatRequestBody> {
    const body = await request.json().catch(() => {
      throw buildError("request body is not valid JSON", {
        cause: ErrorCause.BadRequest,
      });
    });

    return parseSubmitChatBody(body);
  }

  /**
   * 处理Session错误
   * @private
   */
  #handleSessionError(err: unknown) {
    if (hasErrorCause(err, ErrorCause.NotFound)) {
      return this.#toJsonResponse({ error: err.message }, 404);
    }

    if (hasErrorCause(err, ErrorCause.InvalidState)) {
      return this.#toJsonResponse({ error: err.message }, 409);
    }

    if (hasErrorCause(err, ErrorCause.Config)) {
      return this.#toJsonResponse({ error: err.message }, 500);
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    return this.#toJsonResponse({ error: message }, 500);
  }

  async #syncChatEnqueued(payload: ChatEnqueuedEventPayload) {
    try {
      // handleSubmitChat 中已经先创建了 waiting chat。
      // 这里保留显式入队事件监听，主要是为了让生命周期更完整、调试时更容易对照事件流，
      // 但不再重复写入 session，避免把“创建 chat”和“进入队列”混成一次状态同步。
      if (payload.status !== ChatStatus.WAITING) {
        console.error("Unexpected chat enqueued payload status: %s", payload.status);
      }
    } catch (error) {
      console.error("Failed to sync enqueued chat: %s", error);
    }
  }

  async #syncChatActivated(payload: ChatActivatedEventPayload) {
    try {
      await this.#sessionManager.markChatPending(
        payload.sessionId,
        payload.chatId,
      );
    } catch (error) {
      // activated 同步失败时，优先排查队列激活链路；
      // 如果是 chunk 追加失败，则会落在 #syncChatChunkAppended 的日志里。
      console.error("Failed to sync activated chat: %s", error);
    }
  }

  async #syncChatChunkAppended(payload: ChatChunkAppendedEventPayload) {
    try {
      // chunk 事件只负责流式内容同步，不承担 pending -> processing 的状态推断职责。
      // 这样调试时可以直接通过日志判断问题发生在状态切换，还是发生在流式内容写入。
      await this.#sessionManager.appendChunk(
        payload.sessionId,
        payload.chatId,
        payload.chunk,
      );
    } catch (error) {
      console.error("Failed to sync chat chunk: %s", error);
    }
  }

  async #syncChatCompleted(payload: ChatCompletedEventPayload) {
    if (!payload.sessionId || !payload.chatId || !payload.message) {
      return;
    }

    try {
      await this.#sessionManager.completeChat(
        payload.sessionId,
        payload.chatId,
        payload.message,
      );
    } catch (error) {
      console.error("Failed to sync completed chat: %s", error);
    }
  }

  async #syncChatFailed(payload: ChatFailedEventPayload) {
    if (!payload.sessionId || !payload.chatId || !payload.error) {
      return;
    }

    try {
      await this.#sessionManager.failChat(
        payload.sessionId,
        payload.chatId,
        payload.error,
      );
    } catch (error) {
      console.error("Failed to sync failed chat: %s", error);
    }
  }

  /* ==================== 公开方法 ==================== */

  /**
   * 处理ping请求
   * @public
   */
  handlePing() {
    return new Response("pong");
  }

  /**
   * 处理健康检查请求
   * @public
   */
  handleGetHealth() {
    return new Response("ok");
  }

  /**
   * 处理创建Session请求
   * @public
   */
  async handleCreateSession(_request: BunRequest) {
    try {
      const sessionId = await this.#sessionManager.createSession();
      return this.#toJsonResponse({ sessionId }, 201);
    } catch (err) {
      return this.#handleSessionError(err);
    }
  }

  /**
   * 处理轮询聊天状态请求
   * @public
   */
  async handlePollChat(
    _request: BunRequest,
    sessionId: string,
    chatId: string,
  ) {
    try {
      const result = await this.#sessionManager.pollChat(sessionId, chatId);
      return this.#toJsonResponse(result);
    } catch (err) {
      return this.#handleSessionError(err);
    }
  }

  /**
   * 处理提交聊天请求
   * @public
   */
  async handleSubmitChat(request: BunRequest, sessionId: string) {
    try {
      const chatId = Bun.randomUUIDv7();
      const taskInput = await this.#parseSubmitChatRequest(request);

      await this.#sessionManager.createChat(sessionId, chatId);
      const eventTarget = this;
      const task = buildTaskItem({
        chatId,
        sessionId,
        eventTarget,
        ...taskInput,
      });

      await this.#core.addTask(task);

      return this.#toJsonResponse({ chatId }, 201);
    } catch (err) {
      if (hasErrorCause(err, ErrorCause.BadRequest)) {
        return this.#toBadRequestResponse(err.message);
      }

      return this.#handleSessionError(err);
    }
  }

  /**
   * 尝试启动服务器
   * @public
   * @param port 要监听的端口，未指定时自动查找可用端口
   * @returns 服务器的地址和端口号
   */
  tryStart = tryit((port?: number) => this.#start(port));
}
