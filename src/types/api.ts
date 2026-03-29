import type { UUID } from "./index";
import { TaskState, type RawTaskItem } from "./queue";

export enum APIEvents {
  CHAT_UPDATED = "chat-updated",
  CHAT_FINISHED = "chat-finished",
  CHAT_FAILED = "chat-failed",
}

export enum SessionStatus {
  ACTIVE,
  IDLE,
  ARCHIVED,
}

export enum ChatStatus {
  WAITING = "waiting",
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETE = "complete",
  FAILED = "failed",
}

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
  chatId: UUID;
  createdAt: number;
  updatedAt: number;
  status: ChatStatus;
};

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

export type Chat =
  | WaitingChat
  | PendingChat
  | StreamingChat
  | CompletedChat
  | FailedChat;

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

export type PollChatResult = {
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

export type SubmitChatRequestBody = {
  payload: RawTaskItem["payload"];
  priority?: number;
  channel?: RawTaskItem["channel"];
};

export const parseTaskStateToChatStatus = (
  state: TaskState,
): ChatStatus | undefined => {
  if (state === TaskState.WAITING) {
    return ChatStatus.WAITING;
  }

  if (state === TaskState.PENDING) {
    return ChatStatus.PENDING;
  }

  if (state === TaskState.PROCESSING) {
    return ChatStatus.PROCESSING;
  }

  if (state === TaskState.COMPLETE) {
    return ChatStatus.COMPLETE;
  }

  if (state === TaskState.FAILED) {
    return ChatStatus.FAILED;
  }

  return undefined;
};
