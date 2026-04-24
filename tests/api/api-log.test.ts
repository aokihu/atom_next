import { describe, expect, test } from "bun:test";
import { APIServer } from "@/api";
import { Core } from "@/core";
import { ServiceManager } from "@/libs/service-manage";
import type { LogEntry, LogSink } from "@/libs/log";
import { createLogSystem } from "@/libs/log";
import { resetLogSystem } from "@/libs/log/log-system";
import { ChatEvents } from "@/types/event";
import { ChatStatus } from "@/types/chat";
import { RuntimeService } from "@/services";
import { DefaultConfig } from "@/types/config";

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
    logger: log.createLogger("api"),
  };
};

const createServiceManager = () => {
  const runtime = new RuntimeService();
  runtime.loadCliArgs({
    mode: "server",
    config: "/tmp/config.json",
    workspace: "/tmp",
    sandbox: "/tmp/sandbox",
    serverUrl: "",
    address: "127.0.0.1",
    port: 8787,
    logPipe: undefined,
    logFile: false,
    logSilent: false,
  });
  runtime.loadConfig(DefaultConfig);

  const serviceManager = new ServiceManager();
  serviceManager.register(runtime);

  return serviceManager;
};

const waitForAsyncListener = () => {
  return new Promise((resolve) => setTimeout(resolve, 0));
};

describe("APIServer logging", () => {
  test("logs chat sync failures", async () => {
    const { entries, logger } = createMemoryLog();
    const serviceManager = createServiceManager();
    const core = new Core(serviceManager);
    const api = new APIServer(core, serviceManager, { logger });

    api.emit(ChatEvents.CHAT_ACTIVATED, {
      sessionId: "missing-session",
      chatId: "chat-1",
      status: ChatStatus.PENDING,
    });
    await waitForAsyncListener();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "error",
      source: "api",
      message: "Failed to sync activated chat",
      data: {
        sessionId: "missing-session",
        chatId: "chat-1",
        status: ChatStatus.PENDING,
      },
    });
    expect(entries[0]?.error?.message).toContain("Session not found");
  });
});
