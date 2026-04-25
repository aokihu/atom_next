import type { TaskItem } from "@/types/task";
import type { ChatCompletedEventPayload } from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { isEmpty } from "radashi";
import type { ContextManager } from "../context-manager";

export type RuntimeChatFinalizationResult = {
  finalMessage: string;
  visibleChunk: string | null;
  completedPayload: ChatCompletedEventPayload;
};

type FinalizeChatTurnOptions = {
  resultText: string;
  visibleTextBuffer: string;
};

/**
 * 收束当前 chat 的最终结果。
 * @description
 * 这里只负责：
 * - 记录本轮完整 assistant 输出
 * - 选择最终完成消息
 * - 提交 session continuity
 * - 生成供 workflow/core 发射的完成事件载荷
 *
 * Queue 状态推进和业务事件发射仍由外层 workflow/core 负责。
 */
export function finalizeChatTurn(
  contextManager: ContextManager,
  task: TaskItem,
  options: FinalizeChatTurnOptions,
): RuntimeChatFinalizationResult {
  const accumulatedOutput = contextManager.getAccumulatedAssistantOutput();
  const finalMessage = isEmpty(accumulatedOutput)
    ? options.resultText
    : accumulatedOutput;
  contextManager.setLastAssistantOutput(finalMessage);
  const originalUserInput = contextManager.getCurrentChatOriginalUserInput();

  if (!isEmpty(originalUserInput) && !isEmpty(finalMessage)) {
    contextManager.commitSessionTurn(originalUserInput, finalMessage);
  }

  return {
    finalMessage,
    visibleChunk: isEmpty(options.visibleTextBuffer)
      ? null
      : options.visibleTextBuffer,
    completedPayload: {
      sessionId: task.sessionId,
      chatId: task.chatId,
      status: ChatStatus.COMPLETE,
      message: {
        createdAt: Date.now(),
        data: finalMessage,
      },
    },
  };
}
