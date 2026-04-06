/**
 * 程序启动器
 * @version 1.0.0
 */

import { DefaultConfig } from "@/types/config";
import { parseArguments } from "./cli";
import { parseEnvFiles, setProcessEnv } from "./env";
import { tryParseConfigFile } from "./";
import type { ConfigFileScheme } from "@/types/config";

/* ---------------- */
/*      类型定义     */
/* ---------------- */

type ParsedCliArguments = ReturnType<typeof parseArguments>;

// 启动器返回值
export type BootstrapResult = {
  cliArgs: ParsedCliArguments;
  config: ConfigFileScheme;
};

/* ---------------- */
/*      启动逻辑     */
/* ---------------- */

/**
 * 启动器
 * @param appContext 应用程序上下文
 */
export const bootstrap = async (): Promise<BootstrapResult> => {
  /* --- 命令行解析 --- */
  const cliArgs = parseArguments(Bun.argv.slice(2));

  /* --- 解析环境文件 --- */
  const envArgs = parseEnvFiles(cliArgs.workspace);

  /* --- 解析配置文件 --- */
  const [, configArgs] = await tryParseConfigFile(
    cliArgs.workspace + "/config.json",
  );

  // .env 文件中的变量直接写入进程环境，CLI 参数通过返回值向下传递
  setProcessEnv(envArgs);

  // 返回启动参数和配置参数,环境变量直接写入 process.env
  return {
    cliArgs,
    config: configArgs ?? structuredClone(DefaultConfig),
  };
};
