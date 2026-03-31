/**
 * Chat 事件类型
 * @description
 * 定义 chat 生命周期事件名和对应的 payload 结构。
 */

import type { ChatChunk, ChatMessage, FailedChat } from "./chat";
import { ChatStatus } from "./chat";
import type { UUID } from "./primitive";

/* ==================== */
/* Event Names          */
/* ==================== */

export enum ChatEvents {
  CHAT_ENQUEUED = "chat-enqueued",
  CHAT_ACTIVATED = "chat-activated",
  CHAT_CHUNK_APPENDED = "chat-chunk-appended",
  CHAT_COMPLETED = "chat-completed",
  CHAT_FAILED = "chat-failed",
}

/* ==================== */
/* Event Payloads       */
/* ==================== */

export type ChatEnqueuedEventPayload = {
  sessionId: UUID;
  chatId: UUID;
  status: ChatStatus.WAITING;
};

export type ChatActivatedEventPayload = {
  sessionId: UUID;
  chatId: UUID;
  status: ChatStatus.PENDING;
};

export type ChatChunkAppendedEventPayload = {
  sessionId: UUID;
  chatId: UUID;
  status: ChatStatus.PROCESSING;
  chunk: ChatChunk["data"];
};

export type ChatCompletedEventPayload = {
  sessionId: UUID;
  chatId: UUID;
  status: ChatStatus.COMPLETE;
  message: ChatMessage;
};

export type ChatFailedEventPayload = {
  sessionId: UUID;
  chatId: UUID;
  status: ChatStatus.FAILED;
  error: FailedChat["error"];
};
