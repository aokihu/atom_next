/**
 * 解析环境文件
 */

import type { PathLike } from "bun";
import { existsSync } from "node:fs";
import { config } from "dotenv";

const ENV_FILE_NAMES = [".env.debug", ".env.dev", ".env", ".env.local"];

/**
 * 给定指定的路径,返回所有的环境文件完整路径
 * @param workspace 工作的目录
 * @returns 所有环境文件的完整路径
 */
export const collectEnvFiles = (workspace: PathLike) =>
  ENV_FILE_NAMES.map((f) => `${workspace}/${f}`).filter((f) => existsSync(f));

export const parseEnvFiles = (workspace: PathLike) => {
  const files = collectEnvFiles(workspace);

  const environments: Record<string, string> = {};

  files.map((f) => {
    config({ path: f, override: true, processEnv: environments, quiet: true });
  });

  return environments;
};
