// @ts-nocheck
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseMemoryDatabasePath } from "@/libs";
import { ServiceManager } from "@/libs/service-manage";
import { MemoryService, RuntimeService } from "@/services";

const tempDirs: string[] = [];
const memoryServices: MemoryService[] = [];

const createWorkspace = async () => {
  const workspace = await mkdtemp(join(tmpdir(), "atom-next-memory-"));
  tempDirs.push(workspace);
  return workspace;
};

const buildRuntime = (workspace: string) => {
  const runtime = new RuntimeService();

  runtime.loadCliArgs({
    mode: "server",
    config: join(workspace, "config.json"),
    workspace,
    sandbox: join(workspace, "sandbox"),
    serverUrl: "",
    address: "127.0.0.1",
    port: 8787,
  });

  return runtime;
};

const buildServices = (workspace: string) => {
  const runtime = buildRuntime(workspace);
  const memory = new MemoryService();
  const serviceManager = new ServiceManager();

  serviceManager.register(runtime, memory);
  memoryServices.push(memory);

  return {
    runtime,
    memory,
    serviceManager,
  };
};

afterEach(async () => {
  await Promise.all(
    memoryServices.splice(0).map(async (service) => {
      await service.stop();
    }),
  );
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("MemoryService", () => {
  test("creates memory sqlite schema and registers in service manager", async () => {
    const workspace = await createWorkspace();
    const { memory, serviceManager } = buildServices(workspace);

    expect(serviceManager.getService<MemoryService>("memory")).toBe(memory);

    await serviceManager.startAllServices();

    const databasePath = parseMemoryDatabasePath(workspace);
    expect(await Bun.file(databasePath).exists()).toBe(true);

    const database = new Database(databasePath, { readonly: true });
    const tables = database
      .query(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
          ORDER BY name
        `,
      )
      .all() as Array<{ name: string }>;
    const indexes = database
      .query(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'index'
            AND name LIKE 'idx_%'
          ORDER BY name
        `,
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "link_nodes",
        "memory_events",
        "memory_nodes",
        "memory_nodes_fts",
      ]),
    );
    expect(indexes.map((item) => item.name)).toEqual([
      "idx_link_nodes_source_memory_id",
      "idx_link_nodes_source_memory_key",
      "idx_link_nodes_target_memory_id",
      "idx_link_nodes_target_memory_key",
      "idx_link_nodes_type",
      "idx_memory_events_memory_id",
      "idx_memory_events_memory_key",
      "idx_memory_nodes_memory_key",
      "idx_memory_nodes_scope",
      "idx_memory_nodes_status",
      "idx_memory_nodes_type",
    ]);

    database.close();
  });

  test("saves memory and generates normalized memory key with audit event", async () => {
    const workspace = await createWorkspace();
    const { memory } = buildServices(workspace);

    await memory.start();

    const result = memory.saveMemory({
      text: "  MemoryService uses sqlite storage.  ",
      suggested_key: "Memory Service SQLite",
    });

    expect(result.decision).toBe("create");
    expect(result.memory_key).toBe("long.note.memory_service_sqlite");
    expect(result.output.memory.summary).toBe("MemoryService uses sqlite storage.");
    expect(result.output.memory.text).toBe("MemoryService uses sqlite storage.");

    const database = new Database(parseMemoryDatabasePath(workspace), {
      readonly: true,
    });
    const events = database
      .query(
        `
          SELECT event_type
          FROM memory_events
          ORDER BY created_at ASC
        `,
      )
      .all() as Array<{ event_type: string }>;

    expect(events.map((item) => item.event_type)).toEqual(["memory_created"]);
    database.close();
  });

  test("reuses existing memory on duplicate save", async () => {
    const workspace = await createWorkspace();
    const { memory } = buildServices(workspace);

    await memory.start();

    const first = memory.saveMemory({
      text: "same memory content",
      suggested_key: "same memory",
    });
    const second = memory.saveMemory({
      text: "same memory content",
      suggested_key: "same memory",
    });

    expect(first.memory_key).toBe("long.note.same_memory");
    expect(second.decision).toBe("skip_duplicate");
    expect(second.memory_key).toBe(first.memory_key);
  });

  test("appends short hash when suggested key conflicts with different content", async () => {
    const workspace = await createWorkspace();
    const { memory } = buildServices(workspace);

    await memory.start();

    const first = memory.saveMemory({
      text: "first content",
      suggested_key: "shared key",
    });
    const second = memory.saveMemory({
      text: "second content",
      suggested_key: "shared key",
    });

    expect(first.memory_key).toBe("long.note.shared_key");
    expect(second.memory_key).toMatch(/^long\.note\.shared_key\.[0-9a-f]{8}$/);
  });

  test("creates outgoing link when parent memory key is provided", async () => {
    const workspace = await createWorkspace();
    const { memory } = buildServices(workspace);

    await memory.start();

    const parent = memory.saveMemory({
      text: "parent memory",
      suggested_key: "parent",
      type: "design",
    });
    const child = memory.saveMemory({
      text: "child memory",
      suggested_key: "child",
      links: [
        {
          parent_memory_key: parent.memory_key,
          link_type: "derived_from",
          term: "parent context",
        },
      ],
    });

    const links = memory.getRelatedMemories(child.memory_key);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      target_memory_key: parent.memory_key,
      link_type: "derived_from",
      term: "parent context",
      target_summary: "parent memory",
    });
  });

  test("records root link in event log without creating link row", async () => {
    const workspace = await createWorkspace();
    const { memory } = buildServices(workspace);

    await memory.start();

    const result = memory.saveMemory({
      text: "root linked memory",
      suggested_key: "root child",
      links: [
        {
          parent_memory_key: "root",
          link_type: "relates_to",
          term: "root",
        },
      ],
    });

    expect(memory.getRelatedMemories(result.memory_key)).toEqual([]);

    const database = new Database(parseMemoryDatabasePath(workspace), {
      readonly: true,
    });
    const linkCount = database
      .query("SELECT COUNT(*) AS total FROM link_nodes")
      .get() as { total: number };
    const events = database
      .query(
        `
          SELECT event_type
          FROM memory_events
          ORDER BY created_at ASC
        `,
      )
      .all() as Array<{ event_type: string }>;

    expect(linkCount.total).toBe(0);
    expect(events.map((item) => item.event_type)).toEqual([
      "memory_created",
      "root_link_recorded",
    ]);
    database.close();
  });

  test("supports get search update and status changes through memory outputs", async () => {
    const workspace = await createWorkspace();
    const { memory } = buildServices(workspace);

    await memory.start();

    const saved = memory.saveMemory({
      text: "MemoryService persists design decisions in sqlite",
      suggested_key: "persist design",
      type: "design",
    });

    const byKey = memory.getMemoryByKey(saved.memory_key);
    expect(byKey?.memory.memory_key).toBe(saved.memory_key);

    const search = memory.searchMemory({
      words: "sqlite design decisions",
    });
    expect(search).toHaveLength(1);
    expect(search[0]?.retrieval.mode).toBe("search");
    expect(search[0]?.retrieval.reason).toContain("FTS5 matched sqlite design decisions");

    const updated = memory.updateMemory({
      memory_key: saved.memory_key,
      text: "MemoryService persists design decisions in sqlite database",
      summary: "Persist design decisions in sqlite database",
    });
    expect(updated.memory.text).toBe(
      "MemoryService persists design decisions in sqlite database",
    );

    const statusUpdated = memory.markMemoryStatus({
      memory_key: saved.memory_key,
      status: "deprecated",
      reason: "superseded by v2 design",
    });
    expect(statusUpdated.memory.status).toBe("deprecated");

    const refreshedSearch = memory.searchMemory({
      words: "sqlite database",
    });

    expect(refreshedSearch).toHaveLength(1);
    expect(refreshedSearch[0]).toEqual({
      memory: {
        id: expect.any(String),
        memory_key: saved.memory_key,
        scope: "long",
        type: "design",
        summary: "Persist design decisions in sqlite database",
        text: "MemoryService persists design decisions in sqlite database",
        confidence: 0.7,
        importance: 0.5,
        score: 50,
        source: "user",
        source_ref: null,
        created_at: expect.any(Number),
        updated_at: expect.any(Number),
        last_accessed_at: expect.any(Number),
        last_linked_at: expect.any(Number),
        access_count: 0,
        traverse_count: 0,
        in_degree: 0,
        out_degree: 0,
        status: "deprecated",
        status_reason: "superseded by v2 design",
        superseded_by_memory_id: null,
        expires_at: null,
      },
      retrieval: {
        mode: "search",
        relevance: expect.any(Number),
        reason: "FTS5 matched sqlite database with query sqlite database",
      },
      links: [],
    });

    const database = new Database(parseMemoryDatabasePath(workspace), {
      readonly: true,
    });
    const events = database
      .query(
        `
          SELECT event_type
          FROM memory_events
          ORDER BY created_at ASC
        `,
      )
      .all() as Array<{ event_type: string }>;

    expect(events.map((item) => item.event_type)).toEqual([
      "memory_created",
      "memory_updated",
      "status_changed",
    ]);
    database.close();
  });

  test("matches multi-term mixed-language queries through fts5", async () => {
    const workspace = await createWorkspace();
    const { memory } = buildServices(workspace);

    await memory.start();

    const saved = memory.saveMemory({
      text: "MemoryService 的默认 scope 是 long，默认 type 是 note。",
      suggested_key: "memoryservice defaults",
    });

    const search = memory.searchMemory({
      words: "默认 scope MemoryService 默认 type",
    });

    expect(search).toHaveLength(1);
    expect(search[0]?.memory.memory_key).toBe(saved.memory_key);
    expect(search[0]?.retrieval.reason).toContain(
      "FTS5 matched 默认 scope MemoryService 默认 type",
    );
  });

  test("supplements multi-entity search results when memories are stored separately", async () => {
    const workspace = await createWorkspace();
    const { memory } = buildServices(workspace);

    await memory.start();

    const code1 = memory.saveMemory({
      text: "Code1 是 9527。",
      suggested_key: "Code1",
    });
    const code2 = memory.saveMemory({
      text: "Code2 是 2048。",
      suggested_key: "Code2",
    });

    const search = memory.searchMemory({
      words: "Code1 Code2",
      limit: 5,
    });

    expect(search).toHaveLength(2);
    expect(search.map((item) => item.memory.memory_key).sort()).toEqual([
      code1.memory_key,
      code2.memory_key,
    ].sort());
    expect(search[0]?.retrieval.reason).toContain("Code1 Code2");
    expect(search[1]?.retrieval.reason).toContain("Code1 Code2");
  });

  test("keeps exact memory key match ahead of supplemental term matches", async () => {
    const workspace = await createWorkspace();
    const { memory } = buildServices(workspace);

    await memory.start();

    const exact = memory.saveMemory({
      text: "Exact key memory for Code1 Code2.",
      suggested_key: "Code1 Code2",
    });
    memory.saveMemory({
      text: "Code1 单独记录。",
      suggested_key: "Code1 only",
    });
    memory.saveMemory({
      text: "Code2 单独记录。",
      suggested_key: "Code2 only",
    });

    const search = memory.searchMemory({
      words: exact.memory_key,
      limit: 5,
    });

    expect(search[0]?.memory.memory_key).toBe(exact.memory_key);
    expect(search[0]?.retrieval.reason).toBe(
      `Exact key match for ${exact.memory_key}`,
    );
  });

  test("applies search limit after merging multi-entity candidates", async () => {
    const workspace = await createWorkspace();
    const { memory } = buildServices(workspace);

    await memory.start();

    const code1 = memory.saveMemory({
      text: "Code1 独立记录。",
      suggested_key: "Code1",
    });
    const code2 = memory.saveMemory({
      text: "Code2 独立记录。",
      suggested_key: "Code2",
    });

    const search = memory.searchMemory({
      words: "Code1 Code2",
      limit: 1,
    });

    expect(search).toHaveLength(1);
    expect([code1.memory_key, code2.memory_key]).toContain(
      search[0]?.memory.memory_key,
    );
  });
});
