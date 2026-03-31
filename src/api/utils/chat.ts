/**
 * Chat 工具函数模块
 * @description 提供 Chat 相关的构建和处理工具函数
 */

import type {
  Chat,
  ChatChunk,
  ChatMessage,
  CompletedChat,
  FailedChat,
  PendingChat,
  StreamingChat,
  WaitingChat,
} from "@/types/api";
import { ChatStatus } from "@/types/api";
import type { UUID } from "@/types";
import { isString, last } from "radashi";

/* ==================== */
/*  Chunk Functions     */
/* ==================== */

/**
 * 创建一个新的 ChatChunk
 * @param data 要存储的数据
 * @returns 新的 ChatChunk 对象
 */
export const createChatChunk = (data: any): ChatChunk => {
  return {
    id: Bun.randomUUIDv7(),
    createdAt: Date.now(),
    data,
  };
};

/**
 * 合并多个 ChatChunk 为一个 ChatMessage
 * @param chunks 要合并的 ChatChunk 数组
 * @returns 合并后的 ChatMessage 对象
 */
export const mergeChatChunks = (chunks: ChatChunk[]): ChatMessage => {
  const data = chunks.map((chunk) => chunk.data);
  const createdAt = last(chunks)?.createdAt ?? Date.now();

  return {
    createdAt,
    data: data.every(isString) ? data.join("") : data,
  };
};

/* ==================== */
/*  Builder Functions   */
/* ==================== */

/**
 * 构建一个等待状态的 Chat
 * @param sessionId 会话的 UUID
 * @param chatId Chat 的 UUID
 * @param now 创建时间戳，默认为当前时间
 * @returns WaitingChat 对象
 */
export const buildWaitingChat = (
  sessionId: UUID,
  chatId: UUID,
  now = Date.now(),
): WaitingChat => {
  return {
    sessionId,
    chatId,
    createdAt: now,
    updatedAt: now,
    status: ChatStatus.WAITING,
  };
};

/**
 * 构建一个挂起状态的 Chat
 * @param chat 原始 Chat 对象
 * @param updatedAt 更新时间戳，默认为当前时间
 * @returns PendingChat 对象
 */
export const buildPendingChat = (
  chat: Chat,
  updatedAt = Date.now(),
): PendingChat => {
  return {
    sessionId: chat.sessionId,
    chatId: chat.chatId,
    createdAt: chat.createdAt,
    updatedAt,
    status: ChatStatus.PENDING,
  };
};

/**
 * 构建一个工作中（流式）状态的 Chat
 * @param chat 原始 Chat 对象
 * @param chunk 要添加的 ChatChunk
 * @param updatedAt 更新时间戳，默认为当前时间
 * @returns StreamingChat 对象
 */
export const buildWorkingChat = (
  chat: Chat,
  chunk: ChatChunk,
  updatedAt = Date.now(),
): StreamingChat => {
  if (chat.status === ChatStatus.PROCESSING) {
    return {
      ...chat,
      updatedAt,
      chunks: [...chat.chunks, chunk],
    };
  }

  return {
    sessionId: chat.sessionId,
    chatId: chat.chatId,
    createdAt: chat.createdAt,
    updatedAt,
    status: ChatStatus.PROCESSING,
    chunks: [chunk],
  };
};

/**
 * 构建一个已完成状态的 Chat
 * @param chat 原始 Chat 对象
 * @param message 最终的 ChatMessage
 * @param finishedAt 完成时间戳，默认为当前时间
 * @returns CompletedChat 对象
 */
export const buildCompletedChat = (
  chat: Chat,
  message: ChatMessage,
  finishedAt = Date.now(),
): CompletedChat => {
  return {
    sessionId: chat.sessionId,
    chatId: chat.chatId,
    createdAt: chat.createdAt,
    updatedAt: finishedAt,
    finishedAt,
    status: ChatStatus.COMPLETE,
    message,
  };
};

/**
 * 构建一个失败状态的 Chat
 * @param chat 原始 Chat 对象
 * @param error 错误信息
 * @param updatedAt 更新时间戳，默认为当前时间
 * @returns FailedChat 对象
 */
export const buildFailedChat = (
  chat: Chat,
  error: FailedChat["error"],
  updatedAt = Date.now(),
): FailedChat => {
  return {
    sessionId: chat.sessionId,
    chatId: chat.chatId,
    createdAt: chat.createdAt,
    updatedAt,
    status: ChatStatus.FAILED,
    error,
  };
};
