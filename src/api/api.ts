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
import { SessionManager } from "./session";
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
    this.#sessionManager = new SessionManager();

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

  handleCreateSession(request: BunRequest) {
    return new Response("session");
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
