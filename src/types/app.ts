/**
 * 应用上下文类型
 * @description
 * 聚合应用启动后需要在服务之间共享的核心对象。
 */

import { Core } from "@/core";
import { ServiceManager } from "@/libs/service-manage";

export type AppContext = {
  core: Core;
  serviceManager: ServiceManager;
};
