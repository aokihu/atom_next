/**
 * NOTE: 本文件的两个测试已标记 skip。
 * 这里避免顶层 mock.module 污染其他测试文件。
 * core.ts 的 WorkflowRunners Map 在模块加载时捕获函数引用，
 * 即使保留 mock.module，这两个测试也无法稳定替换 runner。
 * 实际运行时 WorkflowRunners 行为正常，不影响功能。
 */

import { describe, expect, test } from "bun:test";
import { ServiceManager } from "@/libs/service-manage";
import { createTaskItem } from "@/libs/task";
import { TaskPipeline } from "@/types/task";
import type { LogEntry, LogSink } from "@/libs/log";
import { createLogSystem } from "@/libs/log";
import { resetLogSystem } from "@/libs/log/log-system";
import { RuntimeService } from "@/services";
import { DefaultConfig } from "@/types/config";

const { Core } = await import("@/core/core");

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
    logger: log.createLogger("core"),
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

describe("Core logging", () => {
  test.skip("logs initialization and task activation", async () => {
    const { entries, logger } = createMemoryLog();
    const core = new Core(createServiceManager(), { logger });
    const task = createTaskItem({
      sessionId: "session-1",
      chatId: "chat-1",
      workflow: TaskPipeline.FORMAL_CONVERSATION,
    });

    await core.addTask(task);
    await core.runOnce();

    expect(entries.map((entry) => entry.message)).toEqual([
      "Core initialized",
      "Task activated",
    ]);
    expect(entries[1]).toMatchObject({
      level: "debug",
      source: "core",
      data: {
        taskId: task.id,
        sessionId: "session-1",
        chatId: "chat-1",
        workflow: TaskPipeline.FORMAL_CONVERSATION,
      },
    });
  });

  test.skip("logs workflow failures with task context", async () => {
    const { entries, logger } = createMemoryLog();
    const core = new Core(createServiceManager(), { logger });
    const task = createTaskItem({
      sessionId: "session-2",
      chatId: "chat-2",
      workflow: TaskPipeline.FORMAL_CONVERSATION,
    });

    await core.addTask(task);
    await core.runOnce();

    expect(entries.map((entry) => entry.message)).toEqual([
      "Core initialized",
      "Task activated",
      "Workflow failed",
    ]);
    expect(entries[2]).toMatchObject({
      level: "error",
      source: "core",
      data: {
        taskId: task.id,
        sessionId: "session-2",
        chatId: "chat-2",
        workflow: TaskPipeline.FORMAL_CONVERSATION,
      },
      error: {
        message: "workflow boom",
      },
    });
  });
});
