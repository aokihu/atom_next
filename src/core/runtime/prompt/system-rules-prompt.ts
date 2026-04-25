/**
 * prompt/system-rules-prompt.ts
 * @description
 * 负责组装 Runtime 使用的 system rules prompt。
 *
 * 这里的 system rules prompt 代表 Runtime 使用的统一系统提示词，
 * 静态规则收口在单一 prompt 文件中维护。
 *
 * 它不感知 Runtime 当前上下文，也不负责最终 system message 的总装配。
 */
import systemPromptText from "@/assets/prompts/system_prompt.md" with { type: "text" };

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
 * 这里使用统一的静态 system prompt 文件；
 * 旧的拆分 prompt 文件保留为开发参考，不再参与运行时注入。
 */
export function exportSystemRulesPrompt(
  input: ExportSystemRulesPromptInput,
): string {
  return joinPromptSections([
    input.systemRules,
    systemPromptText,
  ]);
}
