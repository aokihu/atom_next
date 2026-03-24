/**
 * HTTP API接口
 */

import { isNullish, isNumber, type Err } from "radashi";
import type { Core } from "@/core";
import { DEFAULT_HOST, UNAVAILIBLE_PORT } from "@constant";
import type { ServiceManager } from "@/libs/service-manage";
import { tryFindAvaliablePort } from "@/libs";

type StartAPIServerParams = {
  port?: number; // 启动端口
  core?: Core;
  serviceManager?: ServiceManager;
  onAfterStart?: (param: { hostname: string; port: number }) => void;
  onFailed?: (message: string, terminate?: boolean) => void;
};

/**
 * 获取端口
 * @param port 用户传入的指定的端口号,但是不能保证这个端口一定可以运行
 * @returns 返回一个可以使用的端口号
 */
const resolvePort = async (port?: number): Promise<number> => {
  // 用户没有传入端口号的情况,需要尝试自动获取一个可以执行的端口
  if (isNullish(port) || isNaN(port) || port === UNAVAILIBLE_PORT) {
    const [err, availablePort] = await tryFindAvaliablePort();
    if (err) throw err;
    return availablePort;
  }
  return port;
};

/**
 * 启动API接口服务
 */
export const startAPIServer = async ({
  port,
  core,
  serviceManager,
  onAfterStart,
  onFailed,
}: StartAPIServerParams) => {
  /* --- 设置启动端口 --- */
  const listenPort = await resolvePort(port);

  /* --- 启动API服务器 --- */
  try {
    const server = Bun.serve({
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

    // 启动之后尝试将服务器信息传递给外部打印
    onAfterStart?.({ port: listenPort, hostname: DEFAULT_HOST });
  } catch (err) {
    onFailed?.((err as Error).message, true);
  } finally {
  }
};
