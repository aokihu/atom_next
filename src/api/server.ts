/**
 * API Server Class
 * @class APIServer
 * @description 提供内核与外部通讯的接口
 *
 */

import { isNullish, tryit } from "radashi";
import { Core } from "@/core";
import { DEFAULT_HOST, UNAVAILIBLE_PORT } from "@constant";
import { tryFindAvaliablePort } from "@/libs";
import type { ServiceManager } from "@/libs/service-manage";
import type { APIEventNames, UUID, Session } from "@/types/api";
import { EventEmitter } from "node:events";

export class APIServer extends EventEmitter {
  /* ----- 内部私有属性 ----- */

  // 内核对象
  #core: Core;

  // 服务管理器
  #serviceManager: ServiceManager;

  // 会话sessions
  // 外部通讯会话将会保存在这个map中
  #sessions: Map<UUID, Session> = new Map();

  // API HTTP 服务器
  #server: ReturnType<typeof Bun.serve> | undefined;

  constructor(core: Core, serviceManager: ServiceManager) {
    super();

    this.#core = core;
    this.#serviceManager = serviceManager;

    /* --- 设置监听事件 --- */
    this.addListener("chat-updated" satisfies APIEventNames, () => {});
    this.addListener("chat-finished" satisfies APIEventNames, () => {});
    this.addListener("chat-failed" satisfies APIEventNames, () => {});
  }

  /* ----- 内部私有方法 ----- */

  /**
   * 归档Session数据
   */
  private async archiveSeesion(sessionId: UUID): Promise<boolean> {
    // slot function
    return true;
  }

  /**
   * 解封Session数据
   */
  private async unarchiveSession(sessionId: UUID): Promise<boolean> {
    // slot function
    return true;
  }

  /**
   * 获取可用的启动端口
   */
  async #resolvePort(port?: number): Promise<number> {
    if (isNullish(port) || isNaN(port) || port === UNAVAILIBLE_PORT) {
      const [err, availablePort] = await tryFindAvaliablePort();
      if (err) throw err;
      return availablePort;
    }
    return port;
  }

  /* ----- 对外公开方法 ----- */

  /**
   * 启动API HTTP服务器
   * @public
   */
  async start(port: number): Promise<{
    host: string;
    port: number;
  }> {
    const listenPort = await this.#resolvePort(port);

    try {
      this.#server = Bun.serve({
        port: listenPort,
        hostname: DEFAULT_HOST,
        routes: {
          "/ping": {
            GET: () => {
              return new Response("pong");
            },
          },
        },
      });

      // 成功启动返回服务器的端口号和地址
      return { host: DEFAULT_HOST, port: listenPort };
    } catch (err) {
      throw err;
    }
  }

  // 尝试启动服务器
  tryStart = tryit(this.start.bind(this));
}
