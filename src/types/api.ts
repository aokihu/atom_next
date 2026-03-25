export type UUID = string;

export type APIEventNames = "chat-updated" | "chat-finished" | "chat-failed";

export type Chat = {
  chatId: UUID;
  createdAt: number;
  status: any;
};

export type Session = {
  chats: Map<UUID, any>;
  createdAt: number;
  status: any;
};
