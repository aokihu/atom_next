import { buildError, ErrorCause } from "@/libs";
import { ServiceManager } from "@/libs/service-manage";
import type { RuntimeService } from "@/services/runtime";
import type { Chat, ChatMessage, PollChatResult, Session } from "@/types/api";
import { ChatStatus, SessionStatus } from "@/types/api";
import type { UUID } from "@/types";
import { isString } from "radashi";
import {
  hasArchivedSession,
  readArchivedSession,
  writeArchivedSession,
} from "./utils/session-archive";
import {
  buildCompletedChat,
  buildFailedChat,
  buildPendingChat,
  buildWaitingChat,
  buildWorkingChat,
  createChatChunk,
  mergeChatChunks,
} from "./utils/chat";

/* ==================== */
/*     Constants        */
/* ==================== */

const IDLE_AFTER_MS = 5 * 60 * 1000;
const ARCHIVE_AFTER_MS = 30 * 60 * 1000;

/* ==================== */
/*     Class            */
/* ==================== */

/**
 * API Session管理器
 */
export class SessionManager {
  /* ==================== */
  /*  Private Properties  */
  /* ==================== */

  #serviceManager: ServiceManager;
  #sessions: Map<UUID, Session>;

  /* ==================== */
  /*   Public Constructor */
  /* ==================== */

  constructor(serviceManager: ServiceManager) {
    this.#serviceManager = serviceManager;
    this.#sessions = new Map();
  }

  /* ==================== */
  /*   Private Methods    */
  /* ==================== */

  #touchSession(session: Session) {
    session.updatedAt = Date.now();
  }

  #getRuntime(): RuntimeService {
    const runtime = this.#serviceManager.getService<RuntimeService>("runtime");

    if (!runtime) {
      throw buildError("Runtime service not found", {
        cause: ErrorCause.Config,
      });
    }

    return runtime;
  }

  #getWorkspace(): string {
    const workspace = this.#getRuntime().getEnv<string>("WORKSPACE");

    if (!isString(workspace) || workspace.trim() === "") {
      throw buildError("WORKSPACE env not found", {
        cause: ErrorCause.Config,
      });
    }

    return workspace;
  }

  #syncSessionStatus(session: Session): SessionStatus {
    const hasActiveChat = [...session.chats.values()].some(
      (chat) =>
        chat.status === ChatStatus.WAITING ||
        chat.status === ChatStatus.PENDING ||
        chat.status === ChatStatus.PROCESSING,
    );

    if (hasActiveChat) {
      session.status = SessionStatus.ACTIVE;
      return session.status;
    }

    const lastActivity = Math.max(
      session.createdAt,
      session.updatedAt,
      session.lastPolledAt ?? 0,
    );

    session.status =
      Date.now() - lastActivity >= IDLE_AFTER_MS
        ? SessionStatus.IDLE
        : SessionStatus.ACTIVE;

    return session.status;
  }

  #canArchiveSession(session: Session) {
    if (
      [...session.chats.values()].some(
        (chat) =>
          chat.status === ChatStatus.WAITING ||
          chat.status === ChatStatus.PENDING ||
          chat.status === ChatStatus.PROCESSING,
      )
    ) {
      return false;
    }

    if (this.#syncSessionStatus(session) !== SessionStatus.IDLE) {
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
      throw buildError(`Chat not found: ${chatId}`, {
        cause: ErrorCause.NotFound,
      });
    }

    return chat;
  }

  /* ==================== */
  /*   Public Methods     */
  /* ==================== */

  public async createSession(): Promise<UUID> {
    this.#getWorkspace();

    const sessionId = Bun.randomUUIDv7();
    const now = Date.now();

    const session = {
      sessionId,
      status: SessionStatus.ACTIVE,
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
    const chat = buildWaitingChat(sessionId, chatId, now);

    session.chats.set(chatId, chat);
    this.#touchSession(session);
    session.status = SessionStatus.ACTIVE;

    return chat;
  }

  public async appendChunk(sessionId: UUID, chatId: UUID, data: any) {
    const session = await this.#loadSession(sessionId);
    const chat = this.#getChat(session, chatId);
    const nextChunk = createChatChunk(data);
    const now = Date.now();

    if (
      chat.status === ChatStatus.COMPLETE ||
      chat.status === ChatStatus.FAILED
    ) {
      throw buildError(
        `Cannot append chunk to chat in '${chat.status}' status`,
        {
          cause: ErrorCause.InvalidState,
        },
      );
    }

    const nextChat = buildWorkingChat(chat, nextChunk, now);

    session.chats.set(chatId, nextChat);
    this.#touchSession(session);
    session.status = SessionStatus.ACTIVE;

    return nextChat;
  }

  public async markChatPending(sessionId: UUID, chatId: UUID) {
    const session = await this.#loadSession(sessionId);
    const chat = this.#getChat(session, chatId);
    const now = Date.now();

    if (
      chat.status === ChatStatus.COMPLETE ||
      chat.status === ChatStatus.FAILED ||
      chat.status === ChatStatus.PROCESSING
    ) {
      return chat;
    }

    const nextChat = buildPendingChat(chat, now);

    session.chats.set(chatId, nextChat);
    this.#touchSession(session);
    session.status = SessionStatus.ACTIVE;

    return nextChat;
  }

  public async completeChat(
    sessionId: UUID,
    chatId: UUID,
    message?: ChatMessage,
  ) {
    const session = await this.#loadSession(sessionId);
    const chat = this.#getChat(session, chatId);
    const now = Date.now();

    if (chat.status === ChatStatus.COMPLETE) {
      return chat;
    }

    if (chat.status === ChatStatus.FAILED) {
      throw buildError("Cannot complete a failed chat", {
        cause: ErrorCause.InvalidState,
      });
    }

    const chunks = chat.status === ChatStatus.PROCESSING ? chat.chunks : [];
    const nextChat = buildCompletedChat(
      chat,
      message ?? mergeChatChunks(chunks),
      now,
    );

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

    if (chat.status === ChatStatus.FAILED) {
      return chat;
    }

    if (chat.status === ChatStatus.COMPLETE) {
      throw buildError("Cannot fail a completed chat", {
        cause: ErrorCause.InvalidState,
      });
    }

    const nextChat = buildFailedChat(chat, error, now);

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

    if (chat.status === ChatStatus.PROCESSING) {
      result.chunks = chat.chunks;
    }

    if (chat.status === ChatStatus.COMPLETE) {
      result.message = chat.message;
    }

    if (chat.status === ChatStatus.FAILED) {
      result.error = chat.error;
    }

    return result;
  }

  public async archive(sessionId: UUID) {
    const session = this.#sessions.get(sessionId);
    const workspace = this.#getWorkspace();

    if (!session) {
      if (await hasArchivedSession(workspace, sessionId)) {
        return;
      }
      throw buildError(`Session not found: ${sessionId}`, {
        cause: ErrorCause.NotFound,
      });
    }

    if (!this.#canArchiveSession(session)) {
      throw buildError(`Session is not archivable: ${sessionId}`, {
        cause: ErrorCause.InvalidState,
      });
    }

    session.archivedAt = Date.now();
    session.status = SessionStatus.ARCHIVED;
    await writeArchivedSession(workspace, session);

    this.#sessions.delete(sessionId);
  }

  public async unarchive(sessionId: UUID) {
    const existingSession = this.#sessions.get(sessionId);
    if (existingSession) {
      return existingSession;
    }

    const session = await readArchivedSession(this.#getWorkspace(), sessionId);

    if (!session) {
      throw buildError(`Session not found: ${sessionId}`, {
        cause: ErrorCause.NotFound,
      });
    }

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
