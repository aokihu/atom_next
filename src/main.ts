/**
 * Atom Agent System
 * @version 1.0.0
 */

import type { AppContext } from "./types/app";
import { tryBootstrap } from "@/bootstrap";
import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";
import { startAPIServer } from "@/api/";

async function main() {
  // 开始启动器
  const [err, args] = await tryBootstrap();
  if (err || !args) {
    throw err ?? new Error("Bootstrap failed");
  }

  // 启动系统运行时环境服务
  const runtime = new RuntimeService();
  runtime.loadEnv(args.env).loadConfig(args.config);

  // 启动服务管理器
  const serviceManager = new ServiceManager();
  serviceManager.register(runtime);
  await serviceManager.startAllServices();

  // 启动API服务器
  await startAPIServer({
    port: Number(args.env["PORT"]) as number,
    onAfterStart: ({ port, hostname }) => {
      console.log("API server: http://%s:%d", hostname, port);
    },
    onFailed: (message, terminate) => {
      console.error("API server failed: %s", message);
      terminate && process.exit(1);
    },
  });
}

main();
