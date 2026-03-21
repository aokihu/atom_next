/**
 * 程序启动器
 * @version 1.0.0
 */

import type { AppContext } from "@/types/app";
import type { RuntimeService } from "@/services/runtime";
import { map, mapKeys } from "radashi";
import { camelToSnake } from "@/libs/string";
import { parseArguments } from "./cli";
import { parseEnvFiles } from "./env";
import { tryParseConfigFile } from "./";

/**
 * 启动器
 * @param appContext 应用程序上下文
 */
export const bootstrap = async (appContext: AppContext) => {
  /* --- 命令行解析 --- */
  const cliArgs = parseArguments(Bun.argv.slice(2));

  /* --- 解析环境文件 --- */
  const env = parseEnvFiles(cliArgs.workspace);

  /* --- 解析配置文件 --- */
  const [err, cofigArgs] = await tryParseConfigFile(
    cliArgs.workspace + "/config.json",
  );

  /* --- 启动 Gateway --- */

  /* --- 将环境变量和配置参数传递给系统运行时 --- */
  const runtimeService =
    appContext.serviceManager.getService<RuntimeService>("runtime");

  // 启动参数和环境变量需要合并成统一的运行时环境变量
  const { config, ...rest } = cliArgs;
  const bootEnv = mapKeys(rest, (k) => camelToSnake(k).toUpperCase());
  runtimeService?.loadEnv({ ...env, ...bootEnv });

  // 设置运行时配置参数
};
