import type { UUID } from "./index";
import { TaskState, type RawTaskItem } from "./queue";

export type APIEventNames = "chat-updated" | "chat-finished" | "chat-failed";

export type SessionStatus = "active" | "idle" | "archived";

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
  status: TaskState;
};

export type WaitingChat = BaseChat & {
  status: TaskState.WAITING;
};

export type PendingChat = BaseChat & {
  status: TaskState.PENDING;
};

export type StreamingChat = BaseChat & {
  status: TaskState.WORKING;
  chunks: ChatChunk[];
};

export type CompletedChat = BaseChat & {
  status: TaskState.COMPLETE;
  finishedAt: number;
  message: ChatMessage;
};

export type FailedChat = BaseChat & {
  status: TaskState.FAILED;
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
  chatStatus: TaskState;
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
