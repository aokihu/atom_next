/**
 * 程序启动器
 */

import { parseArguments } from "./cli";
import { parseEnvFiles } from "./env";

export const bootstrap = () => {
  /* --- 命令行解析 --- */
  const cliArgs = parseArguments(Bun.argv.slice(2));

  /* --- 解析环境文件 --- */
  const env = parseEnvFiles(cliArgs.workspace);

  /* --- 解析配置文件 --- */

  /* --- 启动 Gateway --- */
};
