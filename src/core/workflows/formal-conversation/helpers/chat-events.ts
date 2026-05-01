import type { TaskItem } from "@/types/task";
import { ChatEvents, type ChatOutputUpdatedEventPayload } from "@/types/event";
import { ChatStatus } from "@/types/chat";

export function emitChatOutputUpdatedEvent(task: TaskItem, delta: string): void {
  const payload: ChatOutputUpdatedEventPayload = {
    sessionId: task.sessionId,
    chatId: task.chatId,
    status: ChatStatus.PROCESSING,
    delta,
  };

  task.eventTarget?.emit(ChatEvents.CHAT_OUTPUT_UPDATED, payload);
}
