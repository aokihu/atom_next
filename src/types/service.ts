import type { AppContext } from "./app";

/**
 * 服务基础接口
 */
export interface Service {
  start: () => void;
  stop: () => void;
  restart: () => void;
}

/**
 * 服务构造函数类型
 */
export interface ServiceConstructor {
  new (appContext: AppContext): Service;
}

/**
 * 基础服务类类型声明
 */
export interface BaseService extends Service {
  // 基础服务类的类型声明
}
