/**
 * 本地网络工具函数
 */

import { DEFAULT_HOST, DEFAULT_PORT, MAX_PORT } from "@constant";
import { createServer } from "node:net";
import { tryit } from "radashi";

async function canUsePort(port: number, host: string) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();

    server.unref();
    server.once("error", () => resolve(false));
    server.listen(
      {
        port,
        host,
        exclusive: true,
      },
      () => {
        server.close(() => resolve(true));
      },
    );
  });
}

/**
 * 从指定端口开始寻找可用的本地端口
 * @param startPort 起始端口,默认从8787开始
 * @param host 监听地址,默认127.0.0.1
 * @returns 返回第一个可用端口
 */
async function findAvaliablePort(
  startPort = DEFAULT_PORT,
  host = DEFAULT_HOST,
) {
  if (
    !Number.isInteger(startPort) ||
    startPort < 1 ||
    startPort > MAX_PORT
  ) {
    throw new RangeError(`Invalid start port: ${startPort}`);
  }

  for (let port = startPort; port <= MAX_PORT; port += 1) {
    if (await canUsePort(port, host)) return port;
  }

  throw new Error(`No available port found from ${startPort}`);
}

export const tryFindAvaliablePort = tryit(findAvaliablePort);
