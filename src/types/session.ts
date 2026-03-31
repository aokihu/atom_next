/**
 * Session 领域类型
 * @description
 * 定义 session 状态、归档结构和轮询结果模型。
 */

import type { Chat, ChatChunk, ChatMessage } from "./chat";
import { ChatStatus } from "./chat";
import type { UUID } from "./primitive";

/* ==================== */
/* Status               */
/* ==================== */

export enum SessionStatus {
  ACTIVE,
  IDLE,
  ARCHIVED,
}

/* ==================== */
/* Core Models          */
/* ==================== */

export type Session = {
  sessionId: UUID;
  chats: Map<UUID, Chat>;
  createdAt: number;
  updatedAt: number;
  lastPolledAt?: number;
  archivedAt?: number;
  status: SessionStatus;
};

export type ArchivedSession = Omit<Session, "chats"> & {
  chats: Record<UUID, Chat>;
};

/* ==================== */
/* Output Models        */
/* ==================== */

export type ChatPollResult = {
  sessionId: UUID;
  sessionStatus: SessionStatus;
  chatId: UUID;
  chatStatus: ChatStatus;
  createdAt: number;
  updatedAt: number;
  chunks?: ChatChunk[];
  message?: ChatMessage;
  error?: {
    message: string;
    code?: string;
  };
};
