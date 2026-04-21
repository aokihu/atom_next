/**
 * service-access.ts
 * @description
 * 负责 Runtime 子域内部对 ServiceManager 的受控访问。
 *
 * 这个文件统一收口：
 * - runtime service 获取
 * - memory service 获取
 * - 基于 runtime service 的派生读取
 *
 * Runtime 主入口不再自己关心 service 定位细节，
 * 只消费这里导出的高层读取函数。
 */
import type { ServiceManager } from "@/libs/service-manage";
import type { MemoryService } from "@/services";
import type { RuntimeService } from "@/services/runtime";
import type { ProviderProfileLevel } from "@/types/config";
import type { TransportModelProfile } from "../transport";

/* ==================== */
/* Base Service Access  */
/* ==================== */

export function resolveRuntimeService(
  serviceManager: ServiceManager,
): RuntimeService {
  const runtime = serviceManager.getService<RuntimeService>("runtime");

  if (!runtime) {
    throw new Error("Runtime service not found");
  }

  return runtime;
}

export function resolveMemoryService(
  serviceManager: ServiceManager,
): MemoryService {
  const memory = serviceManager.getService<MemoryService>("memory");

  if (!memory) {
    throw new Error("Memory service not found");
  }

  return memory;
}

/* ==================== */
/* Derived Service Read */
/* ==================== */

/**
 * 判断当前模式是否允许直接输出 Intent Request 调试日志。
 * @description
 * TUI 和 both 模式会占用当前终端渲染界面，
 * 如果继续向 stdout/stderr 打日志，会直接污染界面显示。
 * 当前先按最小策略收口：只有 server 模式才输出这类调试日志。
 */
export function shouldReportIntentRequestLogs(
  serviceManager: ServiceManager,
): boolean {
  const runtime = resolveRuntimeService(serviceManager);
  const mode = runtime.getAllArguments().mode;

  return mode === "server";
}

/**
 * 读取 Transport 使用的模型档位配置。
 * @description
 * Runtime 只负责提供模型参数，不负责 transport 适配器组装。
 */
export function resolveTransportModelProfile(
  serviceManager: ServiceManager,
  level: ProviderProfileLevel = "balanced",
): TransportModelProfile {
  return {
    level,
    ...resolveRuntimeService(serviceManager).getModelProfileConfigWithLevel(level),
  };
}
