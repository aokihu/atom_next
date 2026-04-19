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

    expect(tables.map((item) => item.name)).toEqual([
      "link_nodes",
      "memory_events",
      "memory_nodes",
    ]);
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

  test("supports get search update status and runtime context retrieval", async () => {
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
      words: "sqlite",
    });
    expect(search).toHaveLength(1);
    expect(search[0]?.retrieval.mode).toBe("search");

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

    const runtimeContext = memory.retrieveRuntimeContext({
      words: "sqlite database",
    });

    expect(runtimeContext).toEqual({
      memory: {
        key: saved.memory_key,
        text: "MemoryService persists design decisions in sqlite database",
        meta: {
          created_at: expect.any(Number),
          updated_at: expect.any(Number),
          score: 50,
          status: "deprecated",
          confidence: 0.7,
          type: "design",
        },
      },
      retrieval: {
        mode: "context",
        relevance: expect.any(Number),
        reason: "Loaded runtime context from search sqlite database",
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
});
