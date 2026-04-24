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
 * 判断当前是否允许记录 Intent Request 调试日志。
 * @description
 * Runtime 只判断日志是否被显式静默。
 * 是否写入 stdout / file / pipe 由 LogSystem sink 决定，避免 Runtime
 * 因 mode 判断错误而阻断 TUI 模式下的 file/pipe 调试数据。
 */
export function shouldReportIntentRequestLogs(
  serviceManager: ServiceManager,
): boolean {
  const runtime = resolveRuntimeService(serviceManager);
  const { logSilent } = runtime.getAllArguments();

  return logSilent !== true;
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
