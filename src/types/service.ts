/**
 * 服务抽象类型
 * @description
 * 约束服务对象的生命周期接口和构造签名。
 */

/* ==================== */
/* Lifecycle Contracts  */
/* ==================== */

export interface Service {
  start: () => void;
  stop: () => void;
  restart: () => void;
}

export interface ServiceConstructor {
  new (): Service;
}

export interface BaseService extends Service {
  // 基础服务类的类型声明
}
