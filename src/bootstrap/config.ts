/**
 * 解析配置文件
 */

import type { PathLike } from "bun";

type ConfigFileScheme = {
  version: 2;
  // LLM供应商和模型配置
  providers: any;
  // Message Gateway配置
  gateway: {
    enable: boolean;
    channels: any[];
  };
};

/**
 * 解析配置文件
 * @param configFilePath 配置文件路径
 */
export const parseConfigFile = (configFilePath: PathLike) => {};
