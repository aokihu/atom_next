/**
 * Bootstrap
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.1
 * @description 串联命令行参数、环境文件和配置文件，产出程序启动所需的统一上下文。
 */

import { DefaultConfig } from "@/types/config";
import { parseEnvFiles, setProcessEnv } from "./env";
import { parseConfigFile } from "./config";
import type { ConfigFileScheme } from "@/types/config";
import type { BootArguments } from "./cli";
import type { Logger } from "@/libs/log";
import { tryit } from "radashi";

const tryParseConfigFile = tryit(parseConfigFile);

/* ---------------- */
/* 类型定义          */
/* ---------------- */

// 启动器返回值，供 main.ts 继续决定启动 server、tui 或两者同时启动。
export type BootstrapResult = {
  cliArgs: BootArguments;
  config: ConfigFileScheme;
};

/* ---------------- */
/* 启动逻辑          */
/* ---------------- */

/**
 * 解析启动上下文。
 * 只有配置文件缺失时才回退默认配置；文件存在但内容非法时直接抛错。
 */
export const bootstrap = async (
  cliArgs: BootArguments,
  logger?: Logger,
): Promise<BootstrapResult> => {
  /* --- 解析环境文件 --- */
  const envArgs = parseEnvFiles(cliArgs.workspace);

  /* --- 解析配置文件 --- */
  const [configError, configArgs] = await tryParseConfigFile(
    cliArgs.config,
    true,
    {
      logger,
    },
  );

  // 配置文件不存在时允许回退默认配置，方便最小启动；
  // 但只要文件存在且内容非法，就应该明确中断启动并把错误抛给上层。
  if (configError) {
    if (
      configError instanceof Error &&
      configError.message === "Config file not found"
    ) {
      setProcessEnv(envArgs);

      return {
        cliArgs,
        config: structuredClone(DefaultConfig),
      };
    }

    const errorMessage =
      configError instanceof Error ? configError.message : String(configError);

    throw new Error(`Config parse failed (${cliArgs.config}): ${errorMessage}`);
  }

  // .env 文件中的变量直接写入进程环境，CLI 参数通过返回值向下传递
  setProcessEnv(envArgs);

  // 返回启动参数和配置参数,环境变量直接写入 process.env
  return {
    cliArgs,
    config: configArgs,
  };
};
