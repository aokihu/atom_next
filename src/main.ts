/**
 * Atom Agent System
 * @version 1.0.0
 */

import { tryBootstrap } from "@/bootstrap";
import { Core } from "@/core";
import { APIServer } from "@/api";
import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService, WatchmanService } from "@/services";

async function main() {
  /* ----- 开始启动器 ----- */
  const [err, args] = await tryBootstrap();
  if (err) {
    console.error("Bootstrap failed: %s", err);
    process.exit(1);
  }

  /* ----- 启动系统运行时环境服务 ----- */
  const runtime = new RuntimeService();
  runtime.loadCliArgs(args.cliArgs).loadConfig(args.config);

  /* ----- 创建Watchman服务 ----- */
  const watchman = new WatchmanService();

  /* ----- 启动服务管理器 ----- */
  const serviceManager = new ServiceManager();
  serviceManager.register(runtime, watchman);
  const startResults = await serviceManager.startAllServices();
  const rejectedResult = startResults.find((result) => result.status === "rejected");

  if (rejectedResult?.status === "rejected") {
    const reason =
      rejectedResult.reason instanceof Error
        ? rejectedResult.reason.message
        : String(rejectedResult.reason);

    console.error("Service startup failed: %s", reason);
    process.exit(1);
  }

  /* ----- 启动内核 -----  */
  const core = new Core(serviceManager);

  /* ----- 启动API服务器 ----- */
  const apiServer = new APIServer(core, serviceManager);
  const [errApi, apiResult] = await apiServer.tryStart(args.cliArgs.port);

  if (errApi) {
    console.error("API server failed: %s", errApi);
    process.exit(1);
  }

  console.log(
    `API server started at http://${apiResult.host}:${apiResult.port}`,
  );

  // 这里更新环境变量成可以正确使用的API服务器端口号
  runtime.setPort(apiResult.port);

  /* ----- 启动TUI ----- */

  /* ----- 启动Gateway ----- */

  /* ----- 启动core ----- */
  core.runloop();
}

main();
