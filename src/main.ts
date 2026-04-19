/**
 * Atom Main
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.1
 * @description 应用主入口，负责根据 bootstrap 结果启动 server、tui 或两者组合模式。
 */

import { tryBootstrap } from "@/bootstrap";
import type { BootstrapResult } from "@/bootstrap/bootstrap";
import { Core } from "@/core";
import { APIServer } from "@/api";
import { ServiceManager } from "@/libs/service-manage";
import { MemoryService, RuntimeService, WatchmanService } from "@/services";
import { startTui } from "@/tui";

const startServerApp = async (args: BootstrapResult) => {
  const { cliArgs, config } = args;

  /* ----- 启动系统运行时环境服务 ----- */
  const runtime = new RuntimeService();
  runtime.loadCliArgs(cliArgs).loadConfig(config);

  /* ----- 创建Watchman服务 ----- */
  const watchman = new WatchmanService();
  const memory = new MemoryService();

  /* ----- 启动服务管理器 ----- */
  const serviceManager = new ServiceManager();
  serviceManager.register(runtime, watchman, memory);
  const startResults = await serviceManager.startAllServices();
  const rejectedResult = startResults.find(
    (result) => result.status === "rejected",
  );

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
  const [errApi, apiResult] = await apiServer.tryStart(cliArgs.port);

  if (errApi) {
    console.error("API server failed: %s", errApi);
    process.exit(1);
  }

  const apiUrl = `http://${apiResult.host}:${apiResult.port}`;

  console.log(`API server started at ${apiUrl}`);

  // 这里更新环境变量成可以正确使用的API服务器端口号
  runtime.setPort(apiResult.port);

  /* ----- 启动TUI ----- */

  /* ----- 启动Gateway ----- */

  /* ----- 启动core ----- */
  core.runloop();

  // 返回实际启动成功后的 API 地址。
  // both 模式下 TUI 需要连接这个真实地址，而不是 CLI 里预设的 serverUrl。
  return {
    apiUrl,
    theme: runtime.getThemeName(),
    workspace: runtime.getWorkspace(),
  };
};

/**
 * 主函数入口。
 * 这里只负责按模式分流，不承担配置解析或主题解析细节。
 */
const main = async () => {
  /* ----- 启动器入口 ----- */
  const [err, args] = await tryBootstrap();
  if (err) {
    console.error("Bootstrap failed: %s", err);
    process.exit(1);
  }

  /* ----- 按启动模式分流 ----- */
  const { mode, serverUrl } = args.cliArgs;

  if (mode === "tui") {
    // TUI 单独启动时，不再进入任何 Server 相关启动步骤。
    await startTui({
      serverUrl,
      workspace: args.cliArgs.workspace,
      theme: args.config.theme,
    });
    return;
  }

  const serverStartResult = await startServerApp(args);

  if (mode === "both") {
    await startTui({
      serverUrl: serverStartResult.apiUrl,
      workspace: serverStartResult.workspace,
      theme: serverStartResult.theme,
    });
  }
};

// 启动主函数
main();
