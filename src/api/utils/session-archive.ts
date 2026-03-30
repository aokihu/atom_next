import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ArchivedSession, Chat, Session } from "@/types/api";
import { SessionStatus } from "@/types/api";
import type { UUID } from "@/types";

const SESSION_ARCHIVE_DIR = "sessions";

const getSessionArchiveDir = (workspace: string) =>
  join(workspace, SESSION_ARCHIVE_DIR);

export const getSessionArchivePath = (workspace: string, sessionId: UUID) =>
  join(getSessionArchiveDir(workspace), `${sessionId}.json`);

const ensureSessionArchiveDir = async (workspace: string) => {
  await mkdir(getSessionArchiveDir(workspace), { recursive: true });
};

export const serializeArchivedSession = (session: Session): ArchivedSession => {
  return {
    ...session,
    status: SessionStatus.ARCHIVED,
    archivedAt: session.archivedAt ?? Date.now(),
    chats: Object.fromEntries(session.chats.entries()),
  };
};

export const deserializeArchivedSession = (raw: ArchivedSession): Session => {
  return {
    ...raw,
    status:
      raw.status === SessionStatus.ARCHIVED ? SessionStatus.IDLE : raw.status,
    chats: new Map(Object.entries(raw.chats) as Array<[UUID, Chat]>),
  };
};

export const hasArchivedSession = async (
  workspace: string,
  sessionId: UUID,
) => {
  return await Bun.file(getSessionArchivePath(workspace, sessionId)).exists();
};

export const writeArchivedSession = async (
  workspace: string,
  session: Session,
) => {
  await ensureSessionArchiveDir(workspace);
  await Bun.write(
    getSessionArchivePath(workspace, session.sessionId),
    JSON.stringify(serializeArchivedSession(session), null, 2),
  );
};

export const readArchivedSession = async (
  workspace: string,
  sessionId: UUID,
) => {
  const file = Bun.file(getSessionArchivePath(workspace, sessionId));

  if (!(await file.exists())) {
    return undefined;
  }

  const raw = (await file.json()) as ArchivedSession;
  return deserializeArchivedSession(raw);
};
