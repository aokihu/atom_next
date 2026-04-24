import { beforeEach, describe, expect, test } from "bun:test";
import type { LogEntry, LogSink } from "@/libs/log";
import {
  createLogSystem,
  getLogSystem,
  normalizeError,
} from "@/libs/log";
import { resetLogSystem } from "@/libs/log/log-system";
import { parseLogFilePath } from "@/libs/log/sinks/file-sink";
import {
  formatPrettyLogEntry,
} from "@/libs/log/formatters/pretty-text";

const createMemorySink = () => {
  const entries: LogEntry[] = [];
  const sink: LogSink = {
    name: "memory",
    write(entry) {
      entries.push(entry);
    },
  };

  return { entries, sink };
};

describe("normalizeError", () => {
  test("normalizes Error instances", () => {
    const error = new Error("boom");

    expect(normalizeError(error)).toMatchObject({
      name: "Error",
      message: "boom",
    });
  });

  test("normalizes non-error values", () => {
    expect(normalizeError("boom")).toEqual({
      message: "boom",
    });
  });
});

describe("createLogSystem", () => {
  beforeEach(() => {
    resetLogSystem();
  });

  test("returns the initialized singleton", () => {
    const log = createLogSystem();

    expect(getLogSystem()).toBe(log);
  });

  test("rejects duplicate initialization", () => {
    createLogSystem();

    expect(() => {
      createLogSystem();
    }).toThrow("LogSystem already initialized");
  });

  test("creates source loggers and dispatches entries to sinks", () => {
    const { entries, sink } = createMemorySink();
    const log = createLogSystem({
      level: "debug",
      sinks: [sink],
    });

    log.createLogger("core").info("Core initialized", {
      tags: ["startup"],
      data: { ok: true },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "info",
      source: "core",
      message: "Core initialized",
      tags: ["startup"],
      data: { ok: true },
    });
  });

  test("filters entries below configured level", () => {
    const { entries, sink } = createMemorySink();
    const log = createLogSystem({
      level: "warn",
      sinks: [sink],
    });
    const logger = log.createLogger("runtime");

    logger.info("Runtime info");
    logger.warn("Runtime warning");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("Runtime warning");
  });

  test("notifies subscribers and sinks from the same hub", () => {
    const { entries, sink } = createMemorySink();
    const observed: LogEntry[] = [];
    const log = createLogSystem({
      level: "debug",
      sinks: [sink],
    });

    const unsubscribe = log.subscribe((entry) => {
      observed.push(entry);
    });

    log.createLogger("api").error("API server failed", {
      error: new Error("port unavailable"),
    });
    unsubscribe();
    log.createLogger("api").info("API server started");

    expect(entries).toHaveLength(2);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.error?.message).toBe("port unavailable");
  });

  test("swallows sink failures", () => {
    const { entries, sink } = createMemorySink();
    const brokenSink: LogSink = {
      name: "broken",
      write() {
        throw new Error("sink failed");
      },
    };
    const log = createLogSystem({
      level: "debug",
      sinks: [brokenSink, sink],
    });

    expect(() => {
      log.createLogger("bootstrap").info("Bootstrap started");
    }).not.toThrow();

    expect(entries).toHaveLength(1);
  });

  test("respects silent mode", () => {
    const { entries, sink } = createMemorySink();
    const observed: LogEntry[] = [];
    const log = createLogSystem({
      level: "debug",
      silent: true,
      sinks: [sink],
    });

    log.subscribe((entry) => {
      observed.push(entry);
    });
    log.createLogger("bootstrap").info("Bootstrap started");

    expect(entries).toHaveLength(0);
    expect(observed).toHaveLength(0);
  });
});

describe("createFileSink", () => {
  test("uses daily log file names under the configured directory", () => {
    expect(
      parseLogFilePath(
        "/workspace/logs",
        new Date(2026, 3, 23, 12, 30),
      ),
    ).toBe("/workspace/logs/atom-2026-04-23.log.jsonl");
  });
});

describe("log output formatters", () => {
  const entry: LogEntry = {
    id: "log-1",
    time: new Date(2026, 3, 24, 10, 30, 15, 123).getTime(),
    level: "info",
    source: "runtime",
    message: "Intent Request dispatched",
    data: {
      request: "SEARCH_MEMORY",
      status: "accepted",
    },
  };

  test("formats pretty text without color for pipe output", () => {
    const formatted = formatPrettyLogEntry(entry, {
      color: false,
    });

    expect(formatted).toContain("[INFO]");
    expect(formatted).toContain("Intent Request dispatched");
    expect(formatted).toContain("request=SEARCH_MEMORY");
    expect(formatted).toContain("status=accepted");
  });

  test("formats pretty text with color for cli output", () => {
    const formatted = formatPrettyLogEntry(entry, {
      color: true,
    });

    expect(formatted).toContain("[INFO]");
    expect(formatted).toContain("runtime");
    expect(formatted).toContain("Intent Request dispatched");
  });
});
