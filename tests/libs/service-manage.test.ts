import { describe, expect, test } from "bun:test";
import { BaseService } from "@/services/base";
import { ServiceManager } from "@/libs/service-manage";
import type { LogEntry, LogSink } from "@/libs/log";
import { createLogSystem } from "@/libs/log";
import { resetLogSystem } from "@/libs/log/log-system";

class TestService extends BaseService {
  constructor(name: string, private readonly shouldFail = false) {
    super();
    this._name = name;
  }

  override async start() {
    if (this.shouldFail) {
      throw new Error(`${this.name} failed`);
    }
  }
}

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
    logger: log.createLogger("service-manager"),
  };
};

describe("ServiceManager", () => {
  test("logs service startup lifecycle", async () => {
    const { entries, logger } = createMemoryLog();
    const serviceManager = new ServiceManager({ logger });

    serviceManager.register(new TestService("runtime"));

    const results = await serviceManager.startAllServices();

    expect(results[0]?.status).toBe("fulfilled");
    expect(entries.map((entry) => entry.message)).toEqual([
      "Service starting",
      "Service started",
    ]);
    expect(entries[0]).toMatchObject({
      source: "service-manager",
      data: {
        service: "runtime",
      },
    });
  });

  test("logs service startup failures and preserves rejected result", async () => {
    const { entries, logger } = createMemoryLog();
    const serviceManager = new ServiceManager({ logger });

    serviceManager.register(new TestService("watchman", true));

    const results = await serviceManager.startAllServices();

    expect(results[0]?.status).toBe("rejected");
    expect(entries.map((entry) => entry.message)).toEqual([
      "Service starting",
      "Service startup failed",
    ]);
    expect(entries[1]?.error?.message).toBe("watchman failed");
  });
});
