/**
 * Memory 领域类型
 * @description
 * 统一定义长期记忆服务的核心数据结构、输入参数和对外输出格式。
 */

export const MEMORY_SCOPES = ["core", "short", "long"] as const;
export const MEMORY_TYPES = [
  "note",
  "fact",
  "preference",
  "constraint",
  "decision",
  "design",
  "bug",
  "experiment",
  "procedure",
  "summary",
  "deprecated",
] as const;
export const MEMORY_SOURCES = [
  "user",
  "assistant",
  "system",
  "tool",
  "file",
  "runtime_summary",
  "maintenance_merge",
] as const;
export const MEMORY_STATUSES = [
  "active",
  "cold",
  "stale",
  "deprecated",
  "merged",
  "conflicted",
  "pending_delete",
  "deleted",
] as const;
export const LINK_TYPES = [
  "relates_to",
  "supports",
  "conflicts_with",
  "supersedes",
  "derived_from",
  "duplicates",
] as const;
export const SAVE_MEMORY_DECISIONS = [
  "create",
  "update_existing",
  "link_existing",
  "mark_conflict",
  "skip_duplicate",
] as const;
export const MEMORY_RETRIEVAL_MODES = [
  "key",
  "search",
  "relation",
  "context",
] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];
export type MemoryType = (typeof MEMORY_TYPES)[number];
export type MemorySource = (typeof MEMORY_SOURCES)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type LinkType = (typeof LINK_TYPES)[number];
export type SaveMemoryDecision = (typeof SAVE_MEMORY_DECISIONS)[number];
export type MemoryRetrievalMode = (typeof MEMORY_RETRIEVAL_MODES)[number];

export type MemoryNode = {
  id: string;
  memory_key: string;
  scope: MemoryScope;
  type: MemoryType;
  summary: string;
  text: string;
  confidence: number;
  importance: number;
  score: number;
  source: MemorySource;
  source_ref: string | null;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  last_linked_at: number;
  access_count: number;
  traverse_count: number;
  in_degree: number;
  out_degree: number;
  status: MemoryStatus;
  status_reason: string | null;
  superseded_by_memory_id: string | null;
  expires_at: number | null;
};

export type LinkNode = {
  id: string;
  source_memory_id: string;
  source_memory_key: string;
  target_memory_id: string;
  target_memory_key: string;
  link_type: LinkType;
  term: string;
  weight: number;
  score: number;
  created_at: number;
  updated_at: number;
};

export type MemoryEvent = {
  id: string;
  memory_id: string | null;
  memory_key: string | null;
  event_type: string;
  payload: string;
  created_at: number;
  created_by: string;
};

export type SaveMemoryLinkInput = {
  parent_memory_key: string | "root";
  link_type: LinkType;
  term: string;
  weight?: number;
};

export type SaveMemoryInput = {
  text: string;
  summary?: string;
  suggested_key?: string;
  links?: SaveMemoryLinkInput[];
  scope?: MemoryScope;
  type?: MemoryType;
  confidence?: number;
  importance?: number;
  source?: MemorySource;
  source_ref?: string;
  created_by?: string;
};

export type SearchMemoryInput = {
  words: string;
  limit?: number;
  scope?: MemoryScope;
};

export type UpdateMemoryInput = {
  memory_key: string;
  summary?: string;
  text?: string;
  type?: MemoryType;
  confidence?: number;
  importance?: number;
  source?: MemorySource;
  source_ref?: string | null;
  expires_at?: number | null;
  created_by?: string;
};

export type MarkMemoryStatusInput = {
  memory_key: string;
  status: MemoryStatus;
  reason?: string;
  superseded_by_memory_key?: string;
  created_by?: string;
};

export type RetrieveRuntimeContextInput = {
  memory_key?: string;
  words?: string;
  scope?: MemoryScope;
};

export type MemoryRetrieval = {
  mode: MemoryRetrievalMode;
  relevance: number;
  reason: string;
};

export type RelatedMemoryLink = LinkNode & {
  target_summary: string;
};

export type MemoryOutput = {
  memory: MemoryNode;
  retrieval: MemoryRetrieval;
  links: RelatedMemoryLink[];
};

export type RuntimeMemoryLink = {
  target_memory_key: string;
  target_summary: string;
  link_type: LinkType;
  term: string;
  weight: number;
};

export type RuntimeMemoryOutput = {
  memory: {
    key: string;
    text: string;
    meta: {
      created_at: number;
      updated_at: number;
      score: number;
      status: MemoryStatus;
      confidence: number;
      type: MemoryType;
    };
  };
  retrieval: MemoryRetrieval;
  links: RuntimeMemoryLink[];
};

export type SaveMemoryResult = {
  decision: SaveMemoryDecision;
  memory_key: string;
  output: MemoryOutput;
};

export type LinkScoreRecalculationResult = {
  updated: number;
};

export type CleanupMemoriesResult = {
  deletedMemories: number;
  deletedLinks: number;
};

export type MergeMemoriesResult = {
  merged: number;
};
