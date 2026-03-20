/**
 * 程序启动器
 */

import { parseArguments } from "./cli";
import { parseEnvFiles } from "./env";

export const bootstrap = () => {
  /* --- 命令行解析 --- */
  const args = parseArguments(Bun.argv.slice(2));
  console.log(args);

  /* --- 解析环境文件 --- */
  const envs = parseEnvFiles(args.workspace);

  console.log(envs);

  /* --- 解析配置文件 --- */

  /* --- 启动 Gateway --- */
};
