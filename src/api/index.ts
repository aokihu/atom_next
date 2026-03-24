/**
 * HTTP API接口
 */

import { isNullish, isNumber } from "radashi";
import type { Core } from "@/core";
import { DEFAULT_HOST, DEFAULT_PORT } from "@constant";
import type { ServiceManager } from "@/libs/service-manage";
import { tryFindAvaliablePort } from "@/libs";

type StartAPIServerParams = {
  port?: number | string; // 启动端口
  core?: Core;
  serviceManager?: ServiceManager;
  onBeforeStart?: (param: { hostname: string; port: number }) => void;
};

const resolveStartPort = (port?: number | string) => {
  if (isNullish(port) || port === "") {
    return DEFAULT_PORT;
  }

  const resolvedPort = isNumber(port) ? port : Number(port);
  if (!Number.isInteger(resolvedPort) || resolvedPort < 1) {
    throw new RangeError(`Invalid API port: ${port}`);
  }

  return resolvedPort;
};

/**
 * 启动API接口服务
 */
export const startAPIServer = async (params: StartAPIServerParams) => {
  const { port, core, serviceManager, onBeforeStart } = params;

  /* --- 设置启动端口 --- */
  const startPort = resolveStartPort(port);
  const [err, availablePort] = await tryFindAvaliablePort(
    startPort,
    DEFAULT_HOST,
  );

  if (!isNullish(err) || isNullish(availablePort)) {
    throw err ?? new Error(`No available port found from ${startPort}`);
  }

  // 启动之前尝试将服务器信息传递给外部打印
  onBeforeStart?.({ port: availablePort, hostname: DEFAULT_HOST });

  /* --- 启动API服务器 --- */
  const server = Bun.serve({
    port: availablePort,
    hostname: DEFAULT_HOST,
    routes: {
      "/ping": {
        GET: () => {
          return new Response("pong");
        },
      },
    },
  });
};
