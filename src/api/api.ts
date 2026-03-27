/**
 * API Server Class
 * @class APIServer
 * @description 提供内核与外部通讯的接口
 *
 */

import type { BunRequest } from "bun";
import type { APIEventNames, SubmitChatRequestBody } from "@/types/api";
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
    this.addListener("chat-updated" satisfies APIEventNames, () => {});
    this.addListener("chat-finished" satisfies APIEventNames, () => {});
    this.addListener("chat-failed" satisfies APIEventNames, () => {});
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

      const task = buildTaskItem({
        chatId,
        sessionId,
        eventTarget: new EventTarget(),
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
