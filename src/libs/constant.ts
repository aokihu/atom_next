/**
 * 全局常量
 */

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const MAX_PORT = 65535;

export const ENV_FILES = [
  ".env.debug",
  ".env.dev",
  ".env",
  ".env.local",
] as const;
