/**
 * 全局常量
 */

export const DEFAULT_HOST = "127.0.0.1";
export const UNAVAILIBLE_PORT = -1;
export const DEFAULT_PORT = 8787;
export const MAX_PORT = 65535;

/**
 * 环境变量文件加载顺序（后加载的覆盖前面的同名变量）
 * 1. `.env` 提供项目通用默认值
 * 2. `.env.dev` 提供开发环境覆盖
 * 3. `.env.debug` 提供调试环境覆盖
 * 4. `.env.local` 提供本机私有最终覆盖
 *
 * 当前项目还没有独立的环境模式选择入口，
 * 因此这里采用固定顺序加载现有的历史文件名。
 */
export const ENV_FILES = [
  ".env",
  ".env.dev",
  ".env.debug",
  ".env.local",
] as const;
