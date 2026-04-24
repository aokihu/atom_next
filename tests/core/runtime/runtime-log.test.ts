import { describe, expect, test } from "bun:test";
import { Runtime } from "@/core/runtime";
import { ServiceManager } from "@/libs/service-manage";
import type { LogEntry, LogSink } from "@/libs/log";
import { createLogSystem } from "@/libs/log";
import { resetLogSystem } from "@/libs/log/log-system";
import { RuntimeService } from "@/services";
import { DefaultConfig } from "@/types/config";
import { buildTaskItem } from "@/libs/task";

const createMemoryLog = () => {
  resetLogSystem();

  const entries: LogEntry[] = [];
  const sink: LogSink = {
    name: "memory",
    write(entry) {
      entries.push(entry);
    },
  };
  const log = createLogSystem({
    level: "debug",
    sinks: [sink],
  });

  return {
    entries,
    logger: log.createLogger("runtime"),
  };
};

const createServiceManager = (logSilent = false) => {
  const runtime = new RuntimeService();
  runtime.loadCliArgs({
    mode: "tui",
    config: "/tmp/config.json",
    workspace: "/tmp",
    sandbox: "/tmp/sandbox",
    serverUrl: "",
    address: "127.0.0.1",
    port: 8787,
    logPipe: undefined,
    logFile: true,
    logSilent,
  });
  runtime.loadConfig(DefaultConfig);

  const serviceManager = new ServiceManager();
  serviceManager.register(runtime);

  return serviceManager;
};

describe("Runtime logging", () => {
  test("logs intent request parse misses through logger", () => {
    const { entries, logger } = createMemoryLog();
    const runtime = new Runtime(createServiceManager(), { logger });

    runtime.parseIntentRequest("not an intent request");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "warn",
      source: "runtime",
      message: "Intent Request parse miss",
      data: {
        intentRequestText: "not an intent request",
      },
    });
  });

  test("logs rejected and dispatched intent requests through logger", () => {
    const { entries, logger } = createMemoryLog();
    const runtime = new Runtime(createServiceManager(), { logger });
    runtime.currentTask = buildTaskItem({
      sessionId: "session-1",
      chatId: "chat-1",
    });

    runtime.parseIntentRequest(
      [
        '[FOLLOW_UP, "wrong chat", sessionId=session-1;chatId=chat-2]',
        '[SEARCH_MEMORY, "search context", words=runtime]',
      ].join("\n"),
    );

    expect(entries.map((entry) => entry.message)).toEqual([
      "Intent Request rejected",
      "Intent Request dispatched",
    ]);
    expect(entries[0]).toMatchObject({
      level: "warn",
      source: "runtime",
      data: {
        request: "FOLLOW_UP",
      },
    });
    expect(entries[1]).toMatchObject({
      level: "info",
      source: "runtime",
      data: {
        request: "SEARCH_MEMORY",
      },
    });
  });

  test("does not log intent requests when log is silent", () => {
    const { entries, logger } = createMemoryLog();
    const runtime = new Runtime(createServiceManager(true), { logger });

    runtime.parseIntentRequest("not an intent request");

    expect(entries).toEqual([]);
  });
});
