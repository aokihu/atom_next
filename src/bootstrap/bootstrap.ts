/**
 * 程序启动器
 * @version 1.0.0
 */

import { isUndefined } from "radashi";
import { camelToSnake } from "@/libs/string";
import { parseArguments } from "./cli";
import { DefaultConfig, type ConfigFileScheme } from "./config";
import { parseEnvFiles } from "./env";
import { tryParseConfigFile } from "./";

/* ---------------- */
/*      类型定义     */
/* ---------------- */

type ParsedCliArguments = ReturnType<typeof parseArguments>;
type CliRuntimeArguments = Omit<ParsedCliArguments, "config">;
type CliEnvValue = CliRuntimeArguments[keyof CliRuntimeArguments];
type EnvFileValue = ReturnType<typeof parseEnvFiles>[string];

type BootstrapEnv = Record<string, EnvFileValue | CliEnvValue>;

// 启动器返回值
export type BootstrapResult = {
  env: BootstrapEnv;
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

  // 启动参数和环境变量需要合并成统一的运行时环境变量
  const { config, ...rest } = cliArgs;
  const bootEnvArgs: Record<string, CliEnvValue> = Object.fromEntries(
    Object.entries(rest)
      .filter(([, value]) => !isUndefined(value))
      .map(([key, value]) => [camelToSnake(key).toUpperCase(), value]),
  );
  const mergedEnv: BootstrapEnv = { ...envArgs, ...bootEnvArgs };

  // 返回启动环境变量,给启动阶段的其他方法调用
  return {
    env: mergedEnv,
    config: configArgs ?? structuredClone(DefaultConfig),
  };
};
