// @ts-nocheck
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrap } from "@/bootstrap/bootstrap";
import { parseArguments } from "@/bootstrap/cli";
import { DefaultConfig } from "@/types/config";
import type { LogEntry, LogSink } from "@/libs/log";
import { createLogSystem } from "@/libs/log";
import { resetLogSystem } from "@/libs/log/log-system";

const tempDirs: string[] = [];
let originalProcessEnv: NodeJS.ProcessEnv = {};

const createBootArguments = async () => {
  const workspace = await mkdtemp(join(tmpdir(), "atom-next-bootstrap-"));
  tempDirs.push(workspace);

  return parseArguments(["--workspace", workspace]);
};

const createMemoryLogger = () => {
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
    logger: log.createLogger("bootstrap"),
  };
};

beforeEach(() => {
  originalProcessEnv = { ...process.env };
});

afterEach(async () => {
  Object.keys(process.env).forEach((key) => {
    if (!(key in originalProcessEnv)) {
      delete process.env[key];
    }
  });

  Object.entries(originalProcessEnv).forEach(([key, value]) => {
    process.env[key] = value;
  });

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("bootstrap", () => {
  test("uses provided cli args and falls back to default config", async () => {
    const cliArgs = await createBootArguments();
    const result = await bootstrap(cliArgs);

    expect(result.cliArgs).toBe(cliArgs);
    expect(result.config).toEqual(DefaultConfig);
  });

  test("reports config warnings through bootstrap logger", async () => {
    const cliArgs = await createBootArguments();
    await writeFile(
      cliArgs.config,
      JSON.stringify({
        providerProfiles: {
          advanced: "deepseek/unknown-model",
        },
      }),
    );
    const { entries, logger } = createMemoryLogger();

    await bootstrap(cliArgs, logger);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "warn",
      source: "bootstrap",
      message: "Config warning",
      data: {
        path: "config.providerProfiles.advanced",
      },
    });
  });
});
