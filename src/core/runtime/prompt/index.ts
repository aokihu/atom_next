import type { TaskItem } from "@/types/task";
import intentPromptText from "@/assets/prompts/intent.md" with { type: "text" };

/* ==================== */
/* Context Prompt       */
/* ==================== */

export {
  resolveAgentsPrompt,
} from "./agents-prompt";

export {
  loadSystemRules,
} from "./system-rules";

export {
  exportRuntimeSystemPrompt,
} from "./runtime-system-prompt";

export {
  exportSystemRulesPrompt,
} from "./system-rules-prompt";

export type {
  ExportSystemRulesPromptInput,
} from "./system-rules-prompt";

export {
  convertConversationContextToPrompt,
  convertFollowUpContextToPrompt,
  convertMemoryScopeContextToPrompt,
  convertIntentPolicyToPrompt,
  convertRuntimeContextToPrompt,
} from "./context-prompt";

/**
 * 从 task 中提取用户输入文本。
 * @description
 * prompt 子域只负责把 payload 中可用于对话的文本部分导出，
 * 不参与 task 生命周期或其他运行时状态判断。
 */
export function exportUserPrompt(task: TaskItem): string {
  return task.payload
    .filter((payload) => payload.type === "text")
    .map((payload) => payload.data)
    .join("\n");
}

/**
 * 导出用户意图预测使用的系统提示词。
 * @description
 * 这份提示词只服务 prediction 子域，
 * 不和正式对话 prompt 或 Intent Request 内置协议混用。
 */
export function exportPredictionPrompt(): string {
  return intentPromptText.trim();
}
