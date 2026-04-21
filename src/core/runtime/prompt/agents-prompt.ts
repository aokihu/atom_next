/**
 * prompt/agents-prompt.ts
 * @description
 * 负责从 RuntimeService 读取当前“可用的” AGENTS 提示词快照。
 *
 * 这个文件不等待 Watchman 编译完成，也不阻塞 Runtime(Core) 热路径。
 * Runtime 需要系统提示词时，只读取一次当前状态：
 * - 已就绪：返回编译后的 AGENTS prompt
 * - 未就绪：返回 fallback prompt
 *
 * 当前 fallback prompt 先使用空字符串，
 * 后续这里可能需要补一份正式的最小兜底提示词，保证降级语义更明确。
 */
import type { RuntimeService } from "@/services/runtime";

/* ==================== */
/* Agents Prompt        */
/* ==================== */

export function resolveAgentsPrompt(runtimeService: RuntimeService): string {
  const status = runtimeService.getUserAgentPromptStatus();

  if (status.phase === "ready") {
    return runtimeService.getUserAgentPrompt();
  }

  return "";
}
