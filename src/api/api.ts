/**
 * API Server Class
 * @class APIServer
 * @description 提供内核与外部通讯的接口
 *
 */

import type { BunRequest } from "bun";
import type { APIEventNames } from "@/types/api";
import { EventEmitter } from "node:events";
import { tryit } from "radashi";
import { ServiceManager } from "@/libs/service-manage";
import { Core } from "@/core";
import { buildTaskItem } from "@/libs";
import {
  ChatNotFoundError,
  SessionConfigError,
  SessionManager,
  SessionNotFoundError,
} from "./session";
import { startServer } from "./server";

export class APIServer extends EventEmitter {
  /* ----- 内部私有属性 ----- */

  #core: Core; // 内核对象
  #serviceManager: ServiceManager; // 服务管理器
  #sessionManager: SessionManager; // Session管理器
  #server: ReturnType<typeof Bun.serve> | undefined; // API HTTP 服务器

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

  /* ------------------- */
  /*      Private        */
  /* ------------------- */

  /**
   * 启动API HTTP服务器
   * @public
   * @param port 要监听的端口，未指定时自动查找可用端口
   * @returns 服务器的地址和端口号
   */
  private async start(port?: number): Promise<{
    host: string;
    port: number;
  }> {
    const { server, host, port: listenPort } = await startServer(this, port);
    this.#server = server;
    return { host, port: listenPort };
  }

  handlePing() {
    return new Response("pong");
  }

  handleGetHealth() {
    return new Response("ok");
  }

  #buildJsonResponse(body: unknown, status = 200) {
    return Response.json(body, { status });
  }

  #handleSessionError(err: unknown) {
    if (
      err instanceof SessionNotFoundError ||
      err instanceof ChatNotFoundError
    ) {
      return this.#buildJsonResponse({ error: err.message }, 404);
    }

    if (err instanceof SessionConfigError) {
      return this.#buildJsonResponse({ error: err.message }, 500);
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    return this.#buildJsonResponse({ error: message }, 500);
  }

  async handleCreateSession(_request: BunRequest) {
    try {
      const sessionId = await this.#sessionManager.createSession();
      return this.#buildJsonResponse({ sessionId }, 201);
    } catch (err) {
      return this.#handleSessionError(err);
    }
  }

  async handlePollChat(
    _request: BunRequest,
    sessionId: string,
    chatId: string,
  ) {
    try {
      const result = await this.#sessionManager.pollChat(sessionId, chatId);
      return this.#buildJsonResponse(result);
    } catch (err) {
      return this.#handleSessionError(err);
    }
  }

  async handleSubmitChat(_request: BunRequest, sessionId: string) {
    const chatId = Bun.randomUUIDv7();
    const eventTarget = this as unknown as EventTarget;

    const task = buildTaskItem({
      chatId,
      sessionId,
      eventTarget,
    });

    this.#core.addTask(task);

    return this.#buildJsonResponse({
      chatId,
    });
  }

  /* -------------------- */
  /*        Public        */
  /* -------------------- */

  /**
   * 尝试启动服务器
   * @param port 要监听的端口，未指定时自动查找可用端口
   * @returns 服务器的地址和端口号
   */
  tryStart = tryit((port?: number) => this.start(port));
}
