import type { RawTaskItem } from "./queue";

export type UUID = string;

export type APIEventNames = "chat-updated" | "chat-finished" | "chat-failed";

export type SessionStatus = "active" | "idle" | "archived";
export type ChatStatus = "pending" | "streaming" | "completed" | "failed";

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

export type PendingChat = BaseChat & {
  status: "pending";
};

export type StreamingChat = BaseChat & {
  status: "streaming";
  chunks: ChatChunk[];
};

export type CompletedChat = BaseChat & {
  status: "completed";
  finishedAt: number;
  message: ChatMessage;
};

export type FailedChat = BaseChat & {
  status: "failed";
  error: {
    message: string;
    code?: string;
  };
};

export type Chat = PendingChat | StreamingChat | CompletedChat | FailedChat;

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
