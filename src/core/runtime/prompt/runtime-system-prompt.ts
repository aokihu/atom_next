/**
 * prompt/runtime-system-prompt.ts
 * @description
 * 负责把 Runtime 当前可用的 prompt 状态快照组合成最终 system message。
 *
 * 这个文件处理的是 Runtime 到 prompt 子域之间的参数收口：
 * - 当前 system rules prompt
 * - 当前可用的 AGENTS prompt
 * - 当前 prompt context snapshot
 * - 当前 session 的 intent policy prompt
 *
 * Runtime 主入口不再关心这些字段如何组合，
 * 只需要把当前状态快照交给这里统一导出。
 */
import type { RuntimeService } from "@/services/runtime";
import type { RuntimePromptContextSnapshot } from "../context-manager";
import { convertRuntimeContextToPrompt } from "./context-prompt";
import { resolveAgentsPrompt } from "./agents-prompt";
import { exportSystemRulesPrompt } from "./system-rules-prompt";

/* ==================== */
/* Runtime Prompt Types */
/* ==================== */

export type ExportRuntimeSystemPromptInput = {
  runtimeService: RuntimeService;
  systemRules: string;
  sessionId: string;
  promptContext: RuntimePromptContextSnapshot;
  exportIntentPolicyPrompt: (sessionId: string) => string[];
};

/* ==================== */
/* Runtime Prompt API   */
/* ==================== */

function joinPromptChunks(chunks: string[]): string {
  return chunks
    .filter((chunk) => chunk.trim() !== "")
    .join("\n");
}

/**
 * 基于 Runtime 当前状态导出最终 system message。
 * @description
 * 这里负责组合三个部分：
 * - system rules prompt
 * - agents prompt
 * - runtime context prompt
 */
export function exportRuntimeSystemPrompt(
  input: ExportRuntimeSystemPromptInput,
): string {
  const systemRulesPrompt = exportSystemRulesPrompt({
    systemRules: input.systemRules,
  });
  const agentsPrompt = resolveAgentsPrompt(input.runtimeService);
  const runtimePrompt = convertRuntimeContextToPrompt({
    ...input.promptContext,
    intentPolicyPrompt: input.exportIntentPolicyPrompt(input.sessionId),
  });

  return joinPromptChunks([
    systemRulesPrompt,
    agentsPrompt,
    runtimePrompt,
  ]);
}
