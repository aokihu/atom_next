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

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      level: "warn",
      source: "runtime",
      message: "Intent Request parse miss",
      data: {
        intentRequestText: "not an intent request",
      },
    });
    expect(entries[1]).toMatchObject({
      level: "debug",
      source: "runtime",
      message: "Intent Request handled",
      data: {
        intentRequestText: "not an intent request",
        parsedRequests: [],
        safeRequests: [],
        rejectedRequests: [],
        dispatchResults: [],
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
        `[FOLLOW_UP_WITH_TOOLS, "continue", summary=${"x".repeat(1001)};nextPrompt=retry]`,
        '[SEARCH_MEMORY, "search context", words=runtime]',
      ].join("\n"),
    );

    expect(entries.map((entry) => entry.message)).toEqual([
      "Intent Request rejected",
      "Intent Request dispatched",
      "Intent Request handled",
    ]);
    expect(entries[0]).toMatchObject({
      level: "warn",
      source: "runtime",
      data: {
        request: "FOLLOW_UP_WITH_TOOLS",
      },
    });
    expect(entries[1]).toMatchObject({
      level: "info",
      source: "runtime",
      data: {
        request: "SEARCH_MEMORY",
      },
    });
    expect(entries[2]).toMatchObject({
      level: "debug",
      source: "runtime",
      data: {
        intentRequestText: [
          `[FOLLOW_UP_WITH_TOOLS, "continue", summary=${"x".repeat(1001)};nextPrompt=retry]`,
          '[SEARCH_MEMORY, "search context", words=runtime]',
        ].join("\n"),
      },
    });
    expect(entries[2]?.data).toMatchObject({
      parsedRequests: [
        {
          request: "FOLLOW_UP_WITH_TOOLS",
        },
        {
          request: "SEARCH_MEMORY",
        },
      ],
      safeRequests: [
        {
          request: "SEARCH_MEMORY",
        },
      ],
      rejectedRequests: [
        {
          code: "follow_up_with_tools_summary_too_long",
        },
      ],
      dispatchResults: [
        {
          request: {
            request: "SEARCH_MEMORY",
          },
          status: "accepted",
        },
      ],
    });
  });

  test("logs handled intent requests when runtime context is missing", () => {
    const { entries, logger } = createMemoryLog();
    const runtime = new Runtime(createServiceManager(), { logger });

    runtime.parseIntentRequest('[FOLLOW_UP, "继续当前回答"]');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "debug",
      source: "runtime",
      message: "Intent Request handled",
      data: {
        intentRequestText: '[FOLLOW_UP, "继续当前回答"]',
        parsedRequests: [
          {
            request: "FOLLOW_UP",
          },
        ],
        safeRequests: [],
        dispatchResults: [],
      },
    });
    expect(entries[0]?.data).toMatchObject({
      rejectedRequests: [
        {
          code: "missing_runtime_context",
        },
      ],
    });
  });

  test("does not log intent requests when log is silent", () => {
    const { entries, logger } = createMemoryLog();
    const runtime = new Runtime(createServiceManager(true), { logger });

    runtime.parseIntentRequest("not an intent request");

    expect(entries).toEqual([]);
  });
});
