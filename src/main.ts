/**
 * Atom Agent System
 * @version 1.0.0
 */

import type { AppContext } from "./types/app";
import { tryBootstrap } from "@/bootstrap";
import { Core } from "@/core";
import { APIServer } from "@/api/server";
import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";
import { tryit } from "radashi";

async function main() {
  /* ----- 开始启动器 ----- */
  const [err, args] = await tryBootstrap();
  if (err || !args) {
    throw err ?? new Error("Bootstrap failed");
  }

  /* ----- 启动系统运行时环境服务 ----- */
  const runtime = new RuntimeService();
  runtime.loadEnv(args.env).loadConfig(args.config);

  /* ----- 启动服务管理器 ----- */
  const serviceManager = new ServiceManager();
  serviceManager.register(runtime);
  await serviceManager.startAllServices();

  /* ----- 启动内核 -----  */
  const core = new Core(serviceManager);

  /* ----- 启动API服务器 ----- */
  const apiServer = new APIServer(core, serviceManager);
  const [errApi, apiResult] = await apiServer.tryStart(
    Number(args.env["PORT"]) as number,
  );

  if (errApi) {
    console.error("API server failed: %s", errApi);
    process.exit(1);
  }

  console.log(
    `API server started at http://${apiResult.host}:${apiResult.port}`,
  );

  // 这里更新环境变量成可以正确使用的API服务器端口号
  runtime.setEnv("PORT", apiResult.port);

  /* ----- 启动TUI ----- */

  /* ----- 启动Gateway ----- */
}

main();
