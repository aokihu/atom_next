/**
 * 解析环境文件
 */

import type { PathLike } from "bun";
import { existsSync } from "node:fs";
import { config } from "dotenv";
import { ENV_FILES } from "@constant";

/**
 * 给定指定的路径,返回所有的环境文件完整路径
 * @param workspace 工作的目录
 * @description 按照 `ENV_FILES` 中声明的顺序收集文件，
 *              后续解析时后面的文件会覆盖前面文件中的同名变量
 * @returns 所有环境文件的完整路径
 */
export const collectEnvFiles = (workspaceDir: PathLike) =>
  ENV_FILES.map((file) => `${workspaceDir}/${file}`).filter((file) =>
    existsSync(file),
  );

export const parseEnvFiles = (workspaceDir: PathLike) => {
  const envFiles = collectEnvFiles(workspaceDir);
  const env: Record<string, string> = {};

  envFiles.forEach((file) => {
    config({ path: file, override: true, processEnv: env, quiet: true });
  });

  return env;
};
