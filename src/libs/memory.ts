import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { LinkNode, MemoryEvent, MemoryNode, RelatedMemoryLink } from "@/types";

const MEMORY_DB_FILE = "memory.sqlite";

const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  memory_key TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  summary TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  importance REAL NOT NULL DEFAULT 0.5,
  score REAL NOT NULL DEFAULT 50,
  source TEXT NOT NULL DEFAULT 'user',
  source_ref TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  last_linked_at INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  traverse_count INTEGER NOT NULL DEFAULT 0,
  in_degree INTEGER NOT NULL DEFAULT 0,
  out_degree INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  status_reason TEXT,
  superseded_by_memory_id TEXT,
  expires_at INTEGER,
  FOREIGN KEY (superseded_by_memory_id) REFERENCES memory_nodes(id)
);

CREATE TABLE IF NOT EXISTS link_nodes (
  id TEXT PRIMARY KEY,
  source_memory_id TEXT NOT NULL,
  source_memory_key TEXT NOT NULL,
  target_memory_id TEXT NOT NULL,
  target_memory_key TEXT NOT NULL,
  link_type TEXT NOT NULL,
  term TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  score REAL NOT NULL DEFAULT 50,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_memory_id) REFERENCES memory_nodes(id),
  FOREIGN KEY (target_memory_id) REFERENCES memory_nodes(id)
);

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  memory_key TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_nodes_fts USING fts5(
  memory_id UNINDEXED,
  memory_key,
  summary,
  text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_memory_key
ON memory_nodes(memory_key);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_scope
ON memory_nodes(scope);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_type
ON memory_nodes(type);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_status
ON memory_nodes(status);

CREATE INDEX IF NOT EXISTS idx_link_nodes_source_memory_id
ON link_nodes(source_memory_id);

CREATE INDEX IF NOT EXISTS idx_link_nodes_target_memory_id
ON link_nodes(target_memory_id);

CREATE INDEX IF NOT EXISTS idx_link_nodes_source_memory_key
ON link_nodes(source_memory_key);

CREATE INDEX IF NOT EXISTS idx_link_nodes_target_memory_key
ON link_nodes(target_memory_key);

CREATE INDEX IF NOT EXISTS idx_link_nodes_type
ON link_nodes(link_type);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory_id
ON memory_events(memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory_key
ON memory_events(memory_key);
`;

const MEMORY_FTS_REBUILD_SQL = `
INSERT INTO memory_nodes_fts(memory_nodes_fts) VALUES('delete-all');
INSERT INTO memory_nodes_fts(memory_id, memory_key, summary, text)
SELECT id, memory_key, summary, text
FROM memory_nodes;
`;

type MemoryNodeRow = Record<string, unknown>;
type LinkNodeRow = Record<string, unknown>;
type MemoryEventRow = Record<string, unknown>;
type RelatedMemoryLinkRow = LinkNodeRow & {
  target_summary: unknown;
};

export const parseMemoryDatabasePath = (workspace: string) => {
  return join(workspace, MEMORY_DB_FILE);
};

const toNullableString = (value: unknown) => {
  return typeof value === "string" ? value : null;
};

const toNumber = (value: unknown) => {
  return typeof value === "number" ? value : Number(value ?? 0);
};

export const createMemoryId = () => {
  return randomUUID();
};

export const createMemoryTimestamp = () => {
  return Date.now();
};

export const createMemoryHash = (value: string, length = 8) => {
  return createHash("sha1").update(value).digest("hex").slice(0, length);
};

export const mapMemoryNode = (row: MemoryNodeRow): MemoryNode => {
  return {
    id: String(row.id),
    memory_key: String(row.memory_key),
    scope: String(row.scope) as MemoryNode["scope"],
    type: String(row.type) as MemoryNode["type"],
    summary: String(row.summary),
    text: String(row.text),
    confidence: toNumber(row.confidence),
    importance: toNumber(row.importance),
    score: toNumber(row.score),
    source: String(row.source) as MemoryNode["source"],
    source_ref: toNullableString(row.source_ref),
    created_at: toNumber(row.created_at),
    updated_at: toNumber(row.updated_at),
    last_accessed_at: toNumber(row.last_accessed_at),
    last_linked_at: toNumber(row.last_linked_at),
    access_count: toNumber(row.access_count),
    traverse_count: toNumber(row.traverse_count),
    in_degree: toNumber(row.in_degree),
    out_degree: toNumber(row.out_degree),
    status: String(row.status) as MemoryNode["status"],
    status_reason: toNullableString(row.status_reason),
    superseded_by_memory_id: toNullableString(row.superseded_by_memory_id),
    expires_at:
      row.expires_at === null || row.expires_at === undefined
        ? null
        : toNumber(row.expires_at),
  };
};

export const mapLinkNode = (row: LinkNodeRow): LinkNode => {
  return {
    id: String(row.id),
    source_memory_id: String(row.source_memory_id),
    source_memory_key: String(row.source_memory_key),
    target_memory_id: String(row.target_memory_id),
    target_memory_key: String(row.target_memory_key),
    link_type: String(row.link_type) as LinkNode["link_type"],
    term: String(row.term),
    weight: toNumber(row.weight),
    score: toNumber(row.score),
    created_at: toNumber(row.created_at),
    updated_at: toNumber(row.updated_at),
  };
};

export const mapMemoryEvent = (row: MemoryEventRow): MemoryEvent => {
  return {
    id: String(row.id),
    memory_id: toNullableString(row.memory_id),
    memory_key: toNullableString(row.memory_key),
    event_type: String(row.event_type),
    payload: String(row.payload),
    created_at: toNumber(row.created_at),
    created_by: String(row.created_by),
  };
};

export const mapRelatedMemoryLink = (
  row: RelatedMemoryLinkRow,
): RelatedMemoryLink => {
  return {
    ...mapLinkNode(row),
    target_summary: String(row.target_summary),
  };
};

export class MemoryStorage {
  #databasePath: string;
  #database: Database | null;

  constructor(workspace: string) {
    this.#databasePath = parseMemoryDatabasePath(workspace);
    this.#database = null;
  }

  public get path() {
    return this.#databasePath;
  }

  public get isReady() {
    return this.#database !== null;
  }

  public open() {
    if (this.#database) {
      return this.#database;
    }

    this.#database = new Database(this.#databasePath, {
      create: true,
      strict: true,
    });
    this.#database.exec("PRAGMA foreign_keys = ON;");
    this.#database.exec(MEMORY_SCHEMA);
    this.#database.exec(MEMORY_FTS_REBUILD_SQL);

    return this.#database;
  }

  public close() {
    this.#database?.close();
    this.#database = null;
  }

  public getDatabase() {
    if (!this.#database) {
      throw new Error("Memory database has not been initialized");
    }

    return this.#database;
  }

  public transaction<T>(callback: (database: Database) => T): T {
    const database = this.getDatabase();
    return database.transaction(() => callback(database))();
  }
}
