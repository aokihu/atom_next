import type { Database } from "bun:sqlite";
import { createMemoryHash, createMemoryId, createMemoryTimestamp, mapMemoryNode, mapRelatedMemoryLink, MemoryStorage, parseMemoryDatabasePath } from "@/libs";
import { BaseService } from "@/services/base";
import type {
  CleanupMemoriesResult,
  LinkScoreRecalculationResult,
  MarkMemoryStatusInput,
  MemoryNode,
  MemoryOutput,
  MergeMemoriesResult,
  RelatedMemoryLink,
  SaveMemoryInput,
  SaveMemoryLinkInput,
  SaveMemoryResult,
  SearchMemoryInput,
  UpdateMemoryInput,
} from "@/types";
import type { RuntimeService } from "./runtime";

const DEFAULT_MEMORY_SCOPE = "long";
const DEFAULT_MEMORY_TYPE = "note";
const DEFAULT_MEMORY_SOURCE = "user";
const DEFAULT_MEMORY_STATUS = "active";
const DEFAULT_MEMORY_CONFIDENCE = 0.7;
const DEFAULT_MEMORY_IMPORTANCE = 0.5;
const DEFAULT_MEMORY_SCORE = 50;
const DEFAULT_LINK_SCORE = 50;
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_CREATED_BY = "memory_service";

type SearchMemoryRow = Record<string, unknown> & {
  exact_key_match: number;
  fts_rank: number;
};

type SearchMemoryCandidate = {
  output: MemoryOutput;
  exactKeyMatch: number;
  matchedTerms: Set<string>;
  bestRelevance: number;
  pass: "combined" | "term";
};

export class MemoryService extends BaseService {
  #storage: MemoryStorage | null;

  constructor() {
    super();
    this._name = "memory";
    this.#storage = null;
  }

  #getRuntime() {
    const runtime = this._serviceManager?.getService<RuntimeService>("runtime");

    if (!runtime) {
      throw new Error("Runtime service not found");
    }

    return runtime;
  }

  #getStorage() {
    if (!this.#storage) {
      throw new Error("Memory service has not been started");
    }

    return this.#storage;
  }

  #getDatabase() {
    return this.#getStorage().getDatabase();
  }

  #normalizeStoredText(text: string) {
    return text.replace(/\r\n/g, "\n").trim();
  }

  #normalizeSummaryText(text: string) {
    return text.replace(/\s+/g, " ").trim();
  }

  #createSummary(text: string) {
    const normalizedText = this.#normalizeSummaryText(text);
    return normalizedText.slice(0, 80);
  }

  #sanitizeSlug(value: string) {
    return value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
  }

  #createSemanticSlug(input: SaveMemoryInput, summary: string, text: string) {
    const rawBase = input.suggested_key?.trim() || summary || text.slice(0, 80);
    const slug = this.#sanitizeSlug(rawBase);

    if (slug !== "") {
      return slug;
    }

    return `memory_${createMemoryHash(text, 8)}`;
  }

  #buildMemoryKeyPrefix(scope: string, type: string, slug: string) {
    return `${scope}.${type}.${slug}`;
  }

  #buildMemoryRetrievalReason(mode: "key" | "search", detail: string) {
    return mode === "key"
      ? `Loaded memory by key: ${detail}`
      : `Matched memory by search: ${detail}`;
  }

  #calculateSearchRelevance(exactKeyMatch: number, ftsRank: number) {
    if (exactKeyMatch > 0) {
      return 1;
    }

    const normalizedRank = Number.isFinite(ftsRank) ? Math.abs(ftsRank) : 1;
    const relevance = 1 / (1 + normalizedRank);

    return Math.max(0.3, Math.min(0.95, relevance));
  }

  #calculateLinkScore(
    weight: number,
    sourceImportance: number,
    targetImportance: number,
  ) {
    const rawScore =
      weight * 50 + sourceImportance * 25 + targetImportance * 25;

    return Math.max(0, Math.min(100, Math.round(rawScore * 100) / 100));
  }

  #parseSearchTerms(words: string) {
    return Array.from(
      new Set(
        (words.match(/[\p{L}\p{N}_]+/gu) ?? [])
          .map((term) => term.trim())
          .filter((term) => term !== ""),
      ),
    );
  }

  #buildFtsQuery(words: string) {
    return this.#parseSearchTerms(words).join(" ");
  }

  #compareSearchCandidates(
    left: SearchMemoryCandidate,
    right: SearchMemoryCandidate,
  ) {
    return right.exactKeyMatch - left.exactKeyMatch
      || right.matchedTerms.size - left.matchedTerms.size
      || right.bestRelevance - left.bestRelevance
      || right.output.memory.score - left.output.memory.score
      || right.output.memory.updated_at - left.output.memory.updated_at;
  }

  #querySearchCandidates(
    database: Database,
    options: {
      searchWords: string;
      ftsQuery: string;
      scope: string;
      limit: number;
      pass: "combined" | "term";
      matchedTerms: string[];
      reason: string;
    },
  ) {
    if (options.ftsQuery === "") {
      return [];
    }

    const rows = database
      .query(
        `
          SELECT
            memory_nodes.*,
            CASE WHEN LOWER(memory_nodes.memory_key) = ? THEN 1 ELSE 0 END AS exact_key_match,
            bm25(memory_nodes_fts, 5.0, 3.0, 1.0) AS fts_rank
          FROM memory_nodes_fts
          INNER JOIN memory_nodes
            ON memory_nodes.id = memory_nodes_fts.memory_id
          WHERE memory_nodes_fts MATCH ?
            AND memory_nodes.scope = ?
            AND memory_nodes.status != 'deleted'
          ORDER BY exact_key_match DESC, fts_rank ASC, memory_nodes.score DESC, memory_nodes.updated_at DESC
          LIMIT ?
        `,
      )
      .all(
        options.searchWords.toLowerCase(),
        options.ftsQuery,
        options.scope,
        options.limit,
      ) as SearchMemoryRow[];

    return rows.map((row) => {
      const memory = mapMemoryNode(row);
      const links = this.#getRelatedMemoriesBySourceId(database, memory.id);
      const exactKeyMatch = Number(row.exact_key_match);
      const ftsRank = Number(row.fts_rank);
      const relevance = this.#calculateSearchRelevance(exactKeyMatch, ftsRank);

      return {
        output: this.#buildMemoryOutput(
          memory,
          {
            mode: "search",
            relevance,
            reason: options.reason,
          },
          links,
        ),
        exactKeyMatch,
        matchedTerms: new Set(options.matchedTerms),
        bestRelevance: relevance,
        pass: options.pass,
      } satisfies SearchMemoryCandidate;
    });
  }

  #mergeSearchCandidate(
    current: SearchMemoryCandidate | undefined,
    incoming: SearchMemoryCandidate,
  ) {
    if (!current) {
      return {
        ...incoming,
        matchedTerms: new Set(incoming.matchedTerms),
      } satisfies SearchMemoryCandidate;
    }

    const nextMatchedTerms = new Set(current.matchedTerms);

    for (const term of incoming.matchedTerms) {
      nextMatchedTerms.add(term);
    }

    const shouldUseIncomingOutput =
      current.pass === "term" && incoming.pass === "combined";

    return {
      output: shouldUseIncomingOutput ? incoming.output : current.output,
      exactKeyMatch: Math.max(current.exactKeyMatch, incoming.exactKeyMatch),
      matchedTerms: nextMatchedTerms,
      bestRelevance: Math.max(current.bestRelevance, incoming.bestRelevance),
      pass: shouldUseIncomingOutput ? incoming.pass : current.pass,
    } satisfies SearchMemoryCandidate;
  }

  #syncMemorySearchDocument(database: Database, memory: MemoryNode) {
    database.query("DELETE FROM memory_nodes_fts WHERE memory_id = ?").run(memory.id);
    database
      .query(
        `
          INSERT INTO memory_nodes_fts (
            memory_id,
            memory_key,
            summary,
            text
          ) VALUES (?, ?, ?, ?)
        `,
      )
      .run(memory.id, memory.memory_key, memory.summary, memory.text);
  }

  #getReadableMemoryRowByKey(database: Database, memoryKey: string) {
    return database
      .query(
        `
          SELECT *
          FROM memory_nodes
          WHERE memory_key = ?
            AND status != 'deleted'
          LIMIT 1
        `,
      )
      .get(memoryKey) as Record<string, unknown> | null;
  }

  #getMemoryRowById(database: Database, memoryId: string) {
    return database
      .query(
        `
          SELECT *
          FROM memory_nodes
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(memoryId) as Record<string, unknown> | null;
  }

  #getRelatedMemoriesBySourceId(database: Database, sourceMemoryId: string) {
    const rows = database
      .query(
        `
          SELECT
            link_nodes.*,
            target.summary AS target_summary
          FROM link_nodes
          INNER JOIN memory_nodes AS target
            ON target.id = link_nodes.target_memory_id
          WHERE link_nodes.source_memory_id = ?
            AND target.status != 'deleted'
          ORDER BY link_nodes.score DESC, link_nodes.updated_at DESC
        `,
      )
      .all(sourceMemoryId) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      return mapRelatedMemoryLink(
        row as Record<string, unknown> & { target_summary: unknown },
      );
    });
  }

  #buildMemoryOutput(
    memory: MemoryNode,
    retrieval: MemoryOutput["retrieval"],
    links: RelatedMemoryLink[],
  ): MemoryOutput {
    return {
      memory,
      retrieval,
      links,
    };
  }

  #getMemoryOutputByKey(
    database: Database,
    memoryKey: string,
    retrieval: MemoryOutput["retrieval"],
  ) {
    const row = this.#getReadableMemoryRowByKey(database, memoryKey);

    if (!row) {
      return null;
    }

    const memory = mapMemoryNode(row as Record<string, unknown>);
    const links = this.#getRelatedMemoriesBySourceId(database, memory.id);

    return this.#buildMemoryOutput(memory, retrieval, links);
  }

  #insertMemoryEvent(
    database: Database,
    input: {
      memory_id: string | null;
      memory_key: string | null;
      event_type: string;
      payload: Record<string, unknown>;
      created_by?: string;
    },
  ) {
    database
      .query(
        `
          INSERT INTO memory_events (
            id,
            memory_id,
            memory_key,
            event_type,
            payload,
            created_at,
            created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        createMemoryId(),
        input.memory_id,
        input.memory_key,
        input.event_type,
        JSON.stringify(input.payload),
        createMemoryTimestamp(),
        input.created_by ?? DEFAULT_CREATED_BY,
      );
  }

  #resolveMemoryKey(
    database: Database,
    scope: string,
    type: string,
    slug: string,
    text: string,
  ) {
    const baseKey = this.#buildMemoryKeyPrefix(scope, type, slug);
    let candidate = baseKey;
    let attempt = 0;

    while (true) {
      const existing = this.#getReadableMemoryRowByKey(database, candidate);

      if (!existing) {
        return candidate;
      }

      if (String(existing.text) === text) {
        return candidate;
      }

      attempt += 1;
      candidate = `${baseKey}.${createMemoryHash(`${text}:${attempt}`, 8)}`;
    }
  }

  #createMemoryNode(
    database: Database,
    input: SaveMemoryInput,
    normalizedText: string,
    summary: string,
  ) {
    const scope = input.scope ?? DEFAULT_MEMORY_SCOPE;
    const type = input.type ?? DEFAULT_MEMORY_TYPE;
    const source = input.source ?? DEFAULT_MEMORY_SOURCE;
    const now = createMemoryTimestamp();
    const slug = this.#createSemanticSlug(input, summary, normalizedText);
    const memoryKey = this.#resolveMemoryKey(
      database,
      scope,
      type,
      slug,
      normalizedText,
    );
    const id = createMemoryId();

    database
      .query(
        `
          INSERT INTO memory_nodes (
            id,
            memory_key,
            scope,
            type,
            summary,
            text,
            confidence,
            importance,
            score,
            source,
            source_ref,
            created_at,
            updated_at,
            last_accessed_at,
            last_linked_at,
            access_count,
            traverse_count,
            in_degree,
            out_degree,
            status,
            status_reason,
            superseded_by_memory_id,
            expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        memoryKey,
        scope,
        type,
        summary,
        normalizedText,
        input.confidence ?? DEFAULT_MEMORY_CONFIDENCE,
        input.importance ?? DEFAULT_MEMORY_IMPORTANCE,
        DEFAULT_MEMORY_SCORE,
        source,
        input.source_ref ?? null,
        now,
        now,
        now,
        now,
        0,
        0,
        0,
        0,
        DEFAULT_MEMORY_STATUS,
        null,
        null,
        null,
      );

    return {
      id,
      memory_key: memoryKey,
    };
  }

  #createMemoryLink(
    database: Database,
    sourceMemory: MemoryNode,
    link: SaveMemoryLinkInput,
    createdBy?: string,
  ) {
    if (link.parent_memory_key === "root") {
      this.#insertMemoryEvent(database, {
        memory_id: sourceMemory.id,
        memory_key: sourceMemory.memory_key,
        event_type: "root_link_recorded",
        payload: {
          parent_memory_key: "root",
          link_type: link.link_type,
          term: link.term,
          weight: link.weight ?? 1,
        },
        created_by: createdBy,
      });
      return;
    }

    const targetRow = this.#getReadableMemoryRowByKey(
      database,
      link.parent_memory_key,
    );

    if (!targetRow) {
      throw new Error(`Parent memory not found: ${link.parent_memory_key}`);
    }

    const targetMemory = mapMemoryNode(targetRow as Record<string, unknown>);
    const now = createMemoryTimestamp();

    database
      .query(
        `
          INSERT INTO link_nodes (
            id,
            source_memory_id,
            source_memory_key,
            target_memory_id,
            target_memory_key,
            link_type,
            term,
            weight,
            score,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        createMemoryId(),
        sourceMemory.id,
        sourceMemory.memory_key,
        targetMemory.id,
        targetMemory.memory_key,
        link.link_type,
        link.term.trim(),
        link.weight ?? 1,
        DEFAULT_LINK_SCORE,
        now,
        now,
      );

    database
      .query(
        `
          UPDATE memory_nodes
          SET
            out_degree = out_degree + 1,
            last_linked_at = ?
          WHERE id = ?
        `,
      )
      .run(now, sourceMemory.id);
    database
      .query(
        `
          UPDATE memory_nodes
          SET
            in_degree = in_degree + 1,
            last_linked_at = ?
          WHERE id = ?
        `,
      )
      .run(now, targetMemory.id);

    this.#insertMemoryEvent(database, {
      memory_id: sourceMemory.id,
      memory_key: sourceMemory.memory_key,
      event_type: "link_created",
      payload: {
        target_memory_key: targetMemory.memory_key,
        link_type: link.link_type,
        term: link.term.trim(),
        weight: link.weight ?? 1,
      },
      created_by: createdBy,
    });
  }

  override async start() {
    const workspace = this.#getRuntime().getWorkspace();
    const databasePath = parseMemoryDatabasePath(workspace);

    if (this.#storage?.path === databasePath && this.#storage.isReady) {
      return;
    }

    this.#storage?.close();
    this.#storage = new MemoryStorage(workspace);
    this.#storage.open();
  }

  override async stop() {
    this.#storage?.close();
    this.#storage = null;
  }

  public getMemoryByKey(memoryKey: string) {
    const output = this.#getMemoryOutputByKey(this.#getDatabase(), memoryKey, {
      mode: "key",
      relevance: 1,
      reason: this.#buildMemoryRetrievalReason("key", memoryKey),
    });

    return output;
  }

  public searchMemory(input: SearchMemoryInput) {
    const database = this.#getDatabase();
    const searchWords = input.words.trim();
    const searchTerms = this.#parseSearchTerms(searchWords);
    const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
    const scope = input.scope ?? DEFAULT_MEMORY_SCOPE;

    if (searchWords === "" || searchTerms.length === 0) {
      return [];
    }
    const candidateMap = new Map<string, SearchMemoryCandidate>();
    const combinedFtsQuery = searchTerms.join(" ");
    const combinedCandidates = this.#querySearchCandidates(database, {
      searchWords,
      ftsQuery: combinedFtsQuery,
      scope,
      limit,
      pass: "combined",
      matchedTerms: searchTerms,
      reason: `FTS5 matched ${searchWords} with query ${combinedFtsQuery}`,
    });

    for (const candidate of combinedCandidates) {
      candidateMap.set(candidate.output.memory.id, candidate);
    }

    if (searchTerms.length > 1 && candidateMap.size < limit) {
      for (const term of searchTerms) {
        const termCandidates = this.#querySearchCandidates(database, {
          searchWords: term,
          ftsQuery: term,
          scope,
          limit,
          pass: "term",
          matchedTerms: [term],
          reason: `FTS5 matched ${searchWords} via term ${term}`,
        });

        for (const candidate of termCandidates) {
          const memoryId = candidate.output.memory.id;
          candidateMap.set(
            memoryId,
            this.#mergeSearchCandidate(candidateMap.get(memoryId), candidate),
          );
        }
      }
    }

    return Array.from(candidateMap.values())
      .sort((left, right) => this.#compareSearchCandidates(left, right))
      .slice(0, limit)
      .map((candidate) => {
        if (candidate.exactKeyMatch > 0) {
          return this.#buildMemoryOutput(
            candidate.output.memory,
            {
              ...candidate.output.retrieval,
              reason: `Exact key match for ${searchWords}`,
            },
            candidate.output.links,
          );
        }

        return candidate.output;
      });
  }

  public getRelatedMemories(memoryKey: string) {
    const database = this.#getDatabase();
    const memoryRow = this.#getReadableMemoryRowByKey(database, memoryKey);

    if (!memoryRow) {
      return [];
    }

    const memory = mapMemoryNode(memoryRow);
    return this.#getRelatedMemoriesBySourceId(database, memory.id);
  }

  public saveMemory(input: SaveMemoryInput): SaveMemoryResult {
    const database = this.#getDatabase();
    const normalizedText = this.#normalizeStoredText(input.text);

    if (normalizedText === "") {
      throw new Error("Memory text cannot be empty");
    }

    const summary = this.#normalizeSummaryText(input.summary?.trim() ?? "")
      || this.#createSummary(normalizedText);
    const createdBy = input.created_by ?? DEFAULT_CREATED_BY;

    return this.#getStorage().transaction((transactionDatabase) => {
      const duplicateRow = transactionDatabase
        .query(
          `
            SELECT *
            FROM memory_nodes
            WHERE scope = ?
              AND type = ?
              AND text = ?
              AND status != 'deleted'
            LIMIT 1
          `,
        )
        .get(
          input.scope ?? DEFAULT_MEMORY_SCOPE,
          input.type ?? DEFAULT_MEMORY_TYPE,
          normalizedText,
        ) as Record<string, unknown> | null;

      if (duplicateRow) {
        const duplicateMemory = mapMemoryNode(duplicateRow);

        this.#insertMemoryEvent(transactionDatabase, {
          memory_id: duplicateMemory.id,
          memory_key: duplicateMemory.memory_key,
          event_type: "skip_duplicate",
          payload: {
            scope: duplicateMemory.scope,
            type: duplicateMemory.type,
            reason: "Same scope/type text already exists",
          },
          created_by: createdBy,
        });

        const output = this.#buildMemoryOutput(
          duplicateMemory,
          {
            mode: "key",
            relevance: 1,
            reason: "Duplicate memory reused",
          },
          this.#getRelatedMemoriesBySourceId(
            transactionDatabase,
            duplicateMemory.id,
          ),
        );

        return {
          decision: "skip_duplicate",
          memory_key: duplicateMemory.memory_key,
          output,
        };
      }

      const createdMemory = this.#createMemoryNode(
        transactionDatabase,
        input,
        normalizedText,
        summary,
      );
      const memoryRow = this.#getMemoryRowById(
        transactionDatabase,
        createdMemory.id,
      );

      if (!memoryRow) {
        throw new Error("Failed to create memory node");
      }

      const memory = mapMemoryNode(memoryRow);
      this.#syncMemorySearchDocument(transactionDatabase, memory);

      this.#insertMemoryEvent(transactionDatabase, {
        memory_id: memory.id,
        memory_key: memory.memory_key,
        event_type: "memory_created",
        payload: {
          scope: memory.scope,
          type: memory.type,
          source: memory.source,
        },
        created_by: createdBy,
      });

      for (const link of input.links ?? []) {
        const normalizedTerm = link.term.trim();

        if (normalizedTerm === "") {
          throw new Error("Memory link term cannot be empty");
        }

        this.#createMemoryLink(
          transactionDatabase,
          memory,
          {
            ...link,
            term: normalizedTerm,
          },
          createdBy,
        );
      }

      const output = this.#getMemoryOutputByKey(
        transactionDatabase,
        memory.memory_key,
        {
          mode: "key",
          relevance: 1,
          reason: this.#buildMemoryRetrievalReason("key", memory.memory_key),
        },
      );

      if (!output) {
        throw new Error("Failed to load created memory");
      }

      return {
        decision: "create",
        memory_key: memory.memory_key,
        output,
      };
    });
  }

  public updateMemory(input: UpdateMemoryInput) {
    const database = this.#getDatabase();
    const createdBy = input.created_by ?? DEFAULT_CREATED_BY;

    return this.#getStorage().transaction((transactionDatabase) => {
      const currentRow = this.#getReadableMemoryRowByKey(
        transactionDatabase,
        input.memory_key,
      );

      if (!currentRow) {
        throw new Error(`Memory not found: ${input.memory_key}`);
      }

      const currentMemory = mapMemoryNode(currentRow);
      const nextText = input.text
        ? this.#normalizeStoredText(input.text)
        : currentMemory.text;
      const nextSummary = input.summary
        ? this.#normalizeSummaryText(input.summary)
        : input.text
          ? this.#createSummary(nextText)
          : currentMemory.summary;
      const now = createMemoryTimestamp();

      transactionDatabase
        .query(
          `
            UPDATE memory_nodes
            SET
              summary = ?,
              text = ?,
              type = ?,
              confidence = ?,
              importance = ?,
              source = ?,
              source_ref = ?,
              expires_at = ?,
              updated_at = ?
            WHERE memory_key = ?
          `,
        )
        .run(
          nextSummary,
          nextText,
          input.type ?? currentMemory.type,
          input.confidence ?? currentMemory.confidence,
          input.importance ?? currentMemory.importance,
          input.source ?? currentMemory.source,
          input.source_ref === undefined
            ? currentMemory.source_ref
            : input.source_ref,
          input.expires_at === undefined ? currentMemory.expires_at : input.expires_at,
          now,
          input.memory_key,
        );

      const refreshedRow = this.#getReadableMemoryRowByKey(
        transactionDatabase,
        input.memory_key,
      );

      if (!refreshedRow) {
        throw new Error(`Memory not found after update: ${input.memory_key}`);
      }

      this.#syncMemorySearchDocument(
        transactionDatabase,
        mapMemoryNode(refreshedRow),
      );

      this.#insertMemoryEvent(transactionDatabase, {
        memory_id: currentMemory.id,
        memory_key: currentMemory.memory_key,
        event_type: "memory_updated",
        payload: {
          summary: nextSummary,
          type: input.type ?? currentMemory.type,
        },
        created_by: createdBy,
      });

      const output = this.#getMemoryOutputByKey(
        transactionDatabase,
        input.memory_key,
        {
          mode: "key",
          relevance: 1,
          reason: this.#buildMemoryRetrievalReason("key", input.memory_key),
        },
      );

      if (!output) {
        throw new Error(`Memory not found after update: ${input.memory_key}`);
      }

      return output;
    });
  }

  public markMemoryStatus(input: MarkMemoryStatusInput) {
    return this.#getStorage().transaction((transactionDatabase) => {
      const currentRow = this.#getReadableMemoryRowByKey(
        transactionDatabase,
        input.memory_key,
      );

      if (!currentRow) {
        throw new Error(`Memory not found: ${input.memory_key}`);
      }

      const currentMemory = mapMemoryNode(currentRow);
      let supersededByMemoryId: string | null = null;

      if (input.superseded_by_memory_key) {
        const supersededByRow = this.#getReadableMemoryRowByKey(
          transactionDatabase,
          input.superseded_by_memory_key,
        );

        if (!supersededByRow) {
          throw new Error(
            `Superseded memory not found: ${input.superseded_by_memory_key}`,
          );
        }

        supersededByMemoryId = String(supersededByRow.id);
      }

      transactionDatabase
        .query(
          `
            UPDATE memory_nodes
            SET
              status = ?,
              status_reason = ?,
              superseded_by_memory_id = ?,
              updated_at = ?
            WHERE memory_key = ?
          `,
        )
        .run(
          input.status,
          input.reason ?? null,
          supersededByMemoryId,
          createMemoryTimestamp(),
          input.memory_key,
        );

      if (input.status === "deleted") {
        transactionDatabase
          .query("DELETE FROM memory_nodes_fts WHERE memory_id = ?")
          .run(currentMemory.id);
      } else {
        const refreshedRow = this.#getReadableMemoryRowByKey(
          transactionDatabase,
          input.memory_key,
        );

        if (!refreshedRow) {
          throw new Error(`Memory not found after status update: ${input.memory_key}`);
        }

        this.#syncMemorySearchDocument(
          transactionDatabase,
          mapMemoryNode(refreshedRow),
        );
      }

      this.#insertMemoryEvent(transactionDatabase, {
        memory_id: currentMemory.id,
        memory_key: currentMemory.memory_key,
        event_type: "status_changed",
        payload: {
          status: input.status,
          reason: input.reason ?? null,
          superseded_by_memory_key: input.superseded_by_memory_key ?? null,
        },
        created_by: input.created_by ?? DEFAULT_CREATED_BY,
      });

      const output = this.#getMemoryOutputByKey(
        transactionDatabase,
        input.memory_key,
        {
          mode: "key",
          relevance: 1,
          reason: this.#buildMemoryRetrievalReason("key", input.memory_key),
        },
      );

      if (!output) {
        throw new Error(`Memory not found after status update: ${input.memory_key}`);
      }

      return output;
    });
  }

  public recalculateLinkScores(): LinkScoreRecalculationResult {
    const database = this.#getDatabase();

    return this.#getStorage().transaction((transactionDatabase) => {
      const rows = transactionDatabase
        .query(
          `
            SELECT
              link_nodes.id,
              link_nodes.source_memory_id,
              link_nodes.source_memory_key,
              link_nodes.weight,
              source.importance AS source_importance,
              target.importance AS target_importance
            FROM link_nodes
            INNER JOIN memory_nodes AS source
              ON source.id = link_nodes.source_memory_id
            INNER JOIN memory_nodes AS target
              ON target.id = link_nodes.target_memory_id
          `,
        )
        .all() as Array<Record<string, unknown>>;

      for (const row of rows) {
        const score = this.#calculateLinkScore(
          Number(row.weight),
          Number(row.source_importance),
          Number(row.target_importance),
        );

        transactionDatabase
          .query(
            `
              UPDATE link_nodes
              SET
                score = ?,
                updated_at = ?
              WHERE id = ?
            `,
          )
          .run(score, createMemoryTimestamp(), String(row.id));

        this.#insertMemoryEvent(transactionDatabase, {
          memory_id: String(row.source_memory_id),
          memory_key: String(row.source_memory_key),
          event_type: "recalculate_link_score",
          payload: {
            score,
            weight: Number(row.weight),
          },
        });
      }

      return {
        updated: rows.length,
      };
    });
  }

  public cleanupMemories(): CleanupMemoriesResult {
    return this.#getStorage().transaction((transactionDatabase) => {
      const doomedRows = transactionDatabase
        .query(
          `
            SELECT *
            FROM memory_nodes
            WHERE status IN ('pending_delete', 'deleted')
          `,
        )
        .all() as Array<Record<string, unknown>>;

      if (doomedRows.length === 0) {
        return {
          deletedMemories: 0,
          deletedLinks: 0,
        };
      }

      const doomedIds = doomedRows.map((row) => String(row.id));
      const placeholders = doomedIds.map(() => "?").join(", ");
      const linkCountRow = transactionDatabase
        .query(
          `
            SELECT COUNT(*) AS total
            FROM link_nodes
            WHERE source_memory_id IN (${placeholders})
               OR target_memory_id IN (${placeholders})
          `,
        )
        .get(...doomedIds, ...doomedIds) as { total: number };

      for (const row of doomedRows) {
        this.#insertMemoryEvent(transactionDatabase, {
          memory_id: String(row.id),
          memory_key: String(row.memory_key),
          event_type: "cleanup_deleted",
          payload: {
            status: String(row.status),
          },
        });
      }

      transactionDatabase
        .query(
          `
            DELETE FROM link_nodes
            WHERE source_memory_id IN (${placeholders})
               OR target_memory_id IN (${placeholders})
          `,
        )
        .run(...doomedIds, ...doomedIds);
      transactionDatabase
        .query(
          `
            DELETE FROM memory_nodes
            WHERE id IN (${placeholders})
          `,
        )
        .run(...doomedIds);

      return {
        deletedMemories: doomedIds.length,
        deletedLinks: Number(linkCountRow.total),
      };
    });
  }

  public mergeMemories(): MergeMemoriesResult {
    return this.#getStorage().transaction((transactionDatabase) => {
      const rows = transactionDatabase
        .query(
          `
            SELECT *
            FROM memory_nodes
            WHERE status NOT IN ('deleted', 'merged')
            ORDER BY created_at ASC
          `,
        )
        .all() as Array<Record<string, unknown>>;

      const grouped = new Map<string, MemoryNode[]>();

      for (const row of rows) {
        const memory = mapMemoryNode(row);
        const groupKey = `${memory.scope}:${memory.type}:${memory.text}`;
        const items = grouped.get(groupKey) ?? [];
        items.push(memory);
        grouped.set(groupKey, items);
      }

      let merged = 0;

      for (const group of grouped.values()) {
        if (group.length < 2) {
          continue;
        }

        const [primary, ...duplicates] = group;

        if (!primary || duplicates.length === 0) {
          continue;
        }

        for (const duplicate of duplicates) {
          transactionDatabase
            .query(
              `
                UPDATE memory_nodes
                SET
                  status = 'merged',
                  status_reason = ?,
                  superseded_by_memory_id = ?,
                  updated_at = ?
                WHERE id = ?
              `,
            )
            .run(
              "Merged by MemoryService",
              primary.id,
              createMemoryTimestamp(),
              duplicate.id,
            );

          this.#insertMemoryEvent(transactionDatabase, {
            memory_id: duplicate.id,
            memory_key: duplicate.memory_key,
            event_type: "memory_merged",
            payload: {
              superseded_by_memory_key: primary.memory_key,
            },
          });
          merged += 1;
        }
      }

      return {
        merged,
      };
    });
  }
}
