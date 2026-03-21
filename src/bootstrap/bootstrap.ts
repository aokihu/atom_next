/**
 * 程序启动器
 * @version 1.0.0
 */

import type { AppContext } from "@/types/app";
import type { RuntimeService } from "@/services/runtime";
import { parseArguments } from "./cli";
import { parseEnvFiles } from "./env";

/**
 * 启动器
 * @param appContext 应用程序上下文
 */
export const bootstrap = (appContext: AppContext) => {
  /* --- 命令行解析 --- */
  const cliArgs = parseArguments(Bun.argv.slice(2));

  /* --- 解析环境文件 --- */
  const env = parseEnvFiles(cliArgs.workspace);

  /* --- 解析配置文件 --- */

  /* --- 启动 Gateway --- */

  /* --- 将环境变量和配置参数传递给系统运行时 --- */
  const runtimeService =
    appContext.serviceManager.getService<RuntimeService>("runtime");
  runtimeService?.loadEnv(env);
};
