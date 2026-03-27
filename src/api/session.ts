import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ServiceManager } from "@/libs/service-manage";
import type { RuntimeService } from "@/services/runtime";
import type {
  ArchivedSession,
  Chat,
  ChatChunk,
  ChatMessage,
  PollChatResult,
  Session,
  SessionStatus,
  UUID,
} from "@/types/api";
import { isString } from "radashi";

const IDLE_AFTER_MS = 5 * 60 * 1000;
const ARCHIVE_AFTER_MS = 30 * 60 * 1000;

export class SessionConfigError extends Error {}
export class SessionNotFoundError extends Error {}
export class ChatNotFoundError extends Error {}
export class SessionStateError extends Error {}

/**
 * API Session管理器
 */

export class SessionManager {
  #serviceManager: ServiceManager;
  #sessions: Map<UUID, Session>;

  /* -------------------- */
  /*      Constructor     */
  /* -------------------- */

  constructor(serviceManager: ServiceManager) {
    this.#serviceManager = serviceManager;
    this.#sessions = new Map();
  }

  /* -------------------- */
  /*       Private        */
  /* -------------------- */

  #touchSession(session: Session) {
    session.updatedAt = Date.now();
  }

  #getRuntime(): RuntimeService {
    const runtime = this.#serviceManager.getService<RuntimeService>("runtime");

    if (!runtime) {
      throw new SessionConfigError("Runtime service not found");
    }

    return runtime;
  }

  #getWorkspace(): string {
    const workspace = this.#getRuntime().getEnv<string>("WORKSPACE");

    if (!isString(workspace) || workspace.trim() === "") {
      throw new SessionConfigError("WORKSPACE env not found");
    }

    return workspace;
  }

  get #archiveDir() {
    return join(this.#getWorkspace(), "sessions");
  }

  #archivePath(sessionId: UUID) {
    return join(this.#archiveDir, `${sessionId}.json`);
  }

  async #ensureArchiveDir() {
    await mkdir(this.#archiveDir, { recursive: true });
  }

  #serializeSession(session: Session): ArchivedSession {
    return {
      ...session,
      status: "archived",
      archivedAt: session.archivedAt ?? Date.now(),
      chats: Object.fromEntries(session.chats.entries()),
    };
  }

  #deserializeSession(raw: ArchivedSession): Session {
    return {
      ...raw,
      status: raw.status === "archived" ? "idle" : raw.status,
      chats: new Map(Object.entries(raw.chats) as Array<[UUID, Chat]>),
    };
  }

  #mergeChatChunks(chunks: ChatChunk[]): ChatMessage {
    const data = chunks.map((chunk) => chunk.data);
    const createdAt = chunks.at(-1)?.createdAt ?? Date.now();

    return {
      createdAt,
      data: data.every((item) => typeof item === "string")
        ? data.join("")
        : data,
    };
  }

  #syncSessionStatus(session: Session): SessionStatus {
    const hasActiveChat = [...session.chats.values()].some(
      (chat) => chat.status === "pending" || chat.status === "streaming",
    );

    if (hasActiveChat) {
      session.status = "active";
      return session.status;
    }

    const lastActivity = Math.max(
      session.createdAt,
      session.updatedAt,
      session.lastPolledAt ?? 0,
    );

    session.status =
      Date.now() - lastActivity >= IDLE_AFTER_MS ? "idle" : "active";

    return session.status;
  }

  #canArchiveSession(session: Session) {
    if (
      [...session.chats.values()].some(
        (chat) => chat.status === "pending" || chat.status === "streaming",
      )
    ) {
      return false;
    }

    if (this.#syncSessionStatus(session) !== "idle") {
      return false;
    }

    return Date.now() - session.createdAt >= ARCHIVE_AFTER_MS;
  }

  async #loadSession(sessionId: UUID): Promise<Session> {
    const session = this.#sessions.get(sessionId);

    if (session) {
      this.#syncSessionStatus(session);
      return session;
    }

    return await this.unarchive(sessionId);
  }

  #getChat(session: Session, chatId: UUID): Chat {
    const chat = session.chats.get(chatId);

    if (!chat) {
      throw new ChatNotFoundError(`Chat not found: ${chatId}`);
    }

    return chat;
  }

  #createChunk(data: any): ChatChunk {
    return {
      id: Bun.randomUUIDv7(),
      createdAt: Date.now(),
      data,
    };
  }

  /* -------------------- */
  /*       Public         */
  /* -------------------- */

  public async createSession(): Promise<UUID> {
    this.#getWorkspace();

    const sessionId = Bun.randomUUIDv7();
    const now = Date.now();

    const session = {
      sessionId,
      status: "active",
      chats: new Map(),
      createdAt: now,
      updatedAt: now,
    } satisfies Session;

    this.#sessions.set(sessionId, session);
    return sessionId;
  }

  public async createChat(sessionId: UUID, chatId: UUID) {
    const session = await this.#loadSession(sessionId);
    const existingChat = session.chats.get(chatId);

    if (existingChat) {
      return existingChat;
    }

    const now = Date.now();
    const chat = {
      chatId,
      createdAt: now,
      updatedAt: now,
      status: "pending",
    } satisfies Chat;

    session.chats.set(chatId, chat);
    this.#touchSession(session);
    session.status = "active";

    return chat;
  }

  public async appendChunk(sessionId: UUID, chatId: UUID, data: any) {
    const session = await this.#loadSession(sessionId);
    const chat = this.#getChat(session, chatId);
    const nextChunk = this.#createChunk(data);
    const now = Date.now();

    if (chat.status === "completed" || chat.status === "failed") {
      throw new SessionStateError(
        `Cannot append chunk to chat in '${chat.status}' status`,
      );
    }

    const nextChat =
      chat.status === "streaming"
        ? {
            ...chat,
            updatedAt: now,
            chunks: [...chat.chunks, nextChunk],
          }
        : {
            chatId: chat.chatId,
            createdAt: chat.createdAt,
            updatedAt: now,
            status: "streaming" as const,
            chunks: [nextChunk],
          };

    session.chats.set(chatId, nextChat);
    this.#touchSession(session);
    session.status = "active";

    return nextChat;
  }

  public async completeChat(sessionId: UUID, chatId: UUID) {
    const session = await this.#loadSession(sessionId);
    const chat = this.#getChat(session, chatId);
    const now = Date.now();

    if (chat.status === "completed") {
      return chat;
    }

    if (chat.status === "failed") {
      throw new SessionStateError("Cannot complete a failed chat");
    }

    const chunks = chat.status === "streaming" ? chat.chunks : [];
    const nextChat = {
      chatId: chat.chatId,
      createdAt: chat.createdAt,
      updatedAt: now,
      finishedAt: now,
      status: "completed" as const,
      message: this.#mergeChatChunks(chunks),
    };

    session.chats.set(chatId, nextChat);
    this.#touchSession(session);
    this.#syncSessionStatus(session);

    return nextChat;
  }

  public async failChat(
    sessionId: UUID,
    chatId: UUID,
    error: { message: string; code?: string },
  ) {
    const session = await this.#loadSession(sessionId);
    const chat = this.#getChat(session, chatId);
    const now = Date.now();

    if (chat.status === "failed") {
      return chat;
    }

    if (chat.status === "completed") {
      throw new SessionStateError("Cannot fail a completed chat");
    }

    const nextChat = {
      chatId: chat.chatId,
      createdAt: chat.createdAt,
      updatedAt: now,
      status: "failed" as const,
      error,
    };

    session.chats.set(chatId, nextChat);
    this.#touchSession(session);
    this.#syncSessionStatus(session);

    return nextChat;
  }

  public async pollChat(
    sessionId: UUID,
    chatId: UUID,
  ): Promise<PollChatResult> {
    const session = await this.#loadSession(sessionId);
    const chat = this.#getChat(session, chatId);

    session.lastPolledAt = Date.now();
    this.#touchSession(session);
    this.#syncSessionStatus(session);

    const result: PollChatResult = {
      sessionId,
      sessionStatus: session.status,
      chatId,
      chatStatus: chat.status,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };

    if (chat.status === "streaming") {
      result.chunks = chat.chunks;
    }

    if (chat.status === "completed") {
      result.message = chat.message;
    }

    if (chat.status === "failed") {
      result.error = chat.error;
    }

    return result;
  }

  public async archive(sessionId: UUID) {
    const session = this.#sessions.get(sessionId);

    if (!session) {
      const file = Bun.file(this.#archivePath(sessionId));
      if (await file.exists()) {
        return;
      }
      throw new SessionNotFoundError(`Session not found: ${sessionId}`);
    }

    if (!this.#canArchiveSession(session)) {
      throw new SessionStateError(`Session is not archivable: ${sessionId}`);
    }

    await this.#ensureArchiveDir();

    session.archivedAt = Date.now();
    session.status = "archived";

    const raw = this.#serializeSession(session);
    await Bun.write(this.#archivePath(sessionId), JSON.stringify(raw, null, 2));

    this.#sessions.delete(sessionId);
  }

  public async unarchive(sessionId: UUID) {
    const existingSession = this.#sessions.get(sessionId);
    if (existingSession) {
      return existingSession;
    }

    const file = Bun.file(this.#archivePath(sessionId));
    if (!(await file.exists())) {
      throw new SessionNotFoundError(`Session not found: ${sessionId}`);
    }

    const raw = (await file.json()) as ArchivedSession;
    const session = this.#deserializeSession(raw);
    this.#sessions.set(sessionId, session);

    return session;
  }

  public async archiveExpiredSessions() {
    const tasks = [...this.#sessions.entries()].map(
      async ([sessionId, session]) => {
        if (this.#canArchiveSession(session)) {
          await this.archive(sessionId);
        }
      },
    );

    await Promise.all(tasks);
  }
}
