/**
 * prompt/system-rules-prompt.ts
 * @description
 * 负责组装 Runtime 使用的 system rules prompt。
 *
 * 这里的 system rules prompt 代表系统内部规则集合，
 * 包含但不限于：
 * - 基础系统规则
 * - Intent Request 协议
 * - memory 使用规则
 * - follow-up 续跑规则
 *
 * 它不感知 Runtime 当前上下文，也不负责最终 system message 的总装配。
 */
import intentRequestPromptText from "@/assets/prompts/intent_request_prompt.md" with { type: "text" };
import systemPromptText from "@/assets/prompts/system.md" with { type: "text" };
import memoryPromptText from "@/assets/prompts/memory.md" with { type: "text" };
import followUpPromptText from "@/assets/prompts/follow_up_prompt.md" with { type: "text" };

/* ==================== */
/* Prompt Types         */
/* ==================== */

export type ExportSystemRulesPromptInput = {
  systemRules: string;
};

/* ==================== */
/* Prompt Helpers       */
/* ==================== */

function joinPromptSections(sections: string[]): string {
  return sections
    .filter((section) => section.trim() !== "")
    .join("\n\n");
}

/* ==================== */
/* System Rules Prompt  */
/* ==================== */

/**
 * 导出 Runtime 使用的 system rules prompt。
 * @description
 * 这里统一拼接所有系统内部规则片段，
 * 包括 Intent Request 在内的内部协议规则都归属在 system rules prompt 中。
 */
export function exportSystemRulesPrompt(
  input: ExportSystemRulesPromptInput,
): string {
  return joinPromptSections([
    input.systemRules,
    systemPromptText,
    intentRequestPromptText,
    memoryPromptText,
    followUpPromptText,
  ]);
}
