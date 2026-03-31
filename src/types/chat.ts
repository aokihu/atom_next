/**
 * Chat 领域类型
 * @description
 * 定义 chat 生命周期中的状态、分片和最终消息结构。
 */

import type { UUID } from "./primitive";

/* ==================== */
/* Status               */
/* ==================== */

export enum ChatStatus {
  WAITING = "waiting",
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETE = "complete",
  FAILED = "failed",
}

/* ==================== */
/* Base Models          */
/* ==================== */

export type ChatChunk = {
  id: UUID;
  createdAt: number;
  data: any;
};

export type ChatMessage = {
  createdAt: number;
  data: any;
};

type BaseChat = {
  sessionId: UUID;
  chatId: UUID;
  createdAt: number;
  updatedAt: number;
  status: ChatStatus;
};

/* ==================== */
/* State Models         */
/* ==================== */

export type WaitingChat = BaseChat & {
  status: ChatStatus.WAITING;
};

export type PendingChat = BaseChat & {
  status: ChatStatus.PENDING;
};

export type StreamingChat = BaseChat & {
  status: ChatStatus.PROCESSING;
  chunks: ChatChunk[];
};

export type CompletedChat = BaseChat & {
  status: ChatStatus.COMPLETE;
  finishedAt: number;
  message: ChatMessage;
};

export type FailedChat = BaseChat & {
  status: ChatStatus.FAILED;
  error: {
    message: string;
    code?: string;
  };
};

/* ==================== */
/* Union Model          */
/* ==================== */

export type Chat =
  | WaitingChat
  | PendingChat
  | StreamingChat
  | CompletedChat
  | FailedChat;
