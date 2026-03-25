/**
 * API Server 启动模块
 * @description 提供API HTTP服务器的启动功能
 */

import { DEFAULT_HOST, UNAVAILIBLE_PORT } from "@constant";
import { tryFindAvaliablePort } from "@/libs";
import { isNullish } from "radashi";

/**
 * 解析可用的启动端口
 * @param port 要监听的端口，未指定时自动查找可用端口
 * @returns 可用的端口号
 */
async function resolvePort(port?: number): Promise<number> {
  if (isNullish(port) || isNaN(port) || port === UNAVAILIBLE_PORT) {
    const [err, availablePort] = await tryFindAvaliablePort();
    if (err) throw err;
    return availablePort;
  }
  return port;
}

/**
 * 启动API HTTP服务器
 * @param port 要监听的端口，未指定时自动查找可用端口
 * @returns 服务器实例和地址信息
 */
export async function startServer(port?: number): Promise<{
  server: ReturnType<typeof Bun.serve>;
  host: string;
  port: number;
}> {
  const listenPort = await resolvePort(port);

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

    return { server, host: DEFAULT_HOST, port: listenPort };
  } catch (err) {
    throw err;
  }
}
