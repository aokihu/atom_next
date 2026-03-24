/**
 * 解析配置文件
 */

import type { PathLike } from "bun";
import { strict } from "node:assert";
import fs from "node:fs";
import { access } from "node:fs/promises";

export type ConfigFileScheme = {
  version: 2;
  // LLM供应商和模型配置
  providers: any;
  // Message Gateway配置
  gateway: {
    enable: boolean;
    channels?: any[];
  };
};

/* 默认的配置参数 */
export const DefaultConfig: ConfigFileScheme = {
  version: 2,
  providers: {},
  gateway: {
    enable: false,
  },
};

/**
 * 解析配置文件
 * @param configFilePath 配置文件路径
 * @param strict 是否严格模式,开启严格模式情况下如果没有找到配置文件,或者配置文件解析失败将会报错
 *               非严格模式下,如果文件不存在或者解析失败,将会返回最小可执行的默认配置参数
 */
export const parseConfigFile: (
  path: PathLike,
  strict?: boolean,
) => Promise<ConfigFileScheme> = async (path, strict = false) => {
  // 检查配置文件是否存在
  if (!(await Bun.file(path as string).exists()) && strict) {
    throw new Error("Config file not found");
  }

  // 初始化默认的配置参数
  const config = structuredClone(DefaultConfig);
  return config;
};
