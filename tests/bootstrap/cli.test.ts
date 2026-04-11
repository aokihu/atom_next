// @ts-nocheck
import { describe, expect, test, beforeEach } from "bun:test";
import { $ } from "bun";
import { version } from "@/../package.json" with { type: "json" };
import { parseArguments } from "@/bootstrap/cli";

describe("parseArguments - direct function tests", () => {
  // 保存原始的 process.cwd 和 process.exit
  const originalCwd = process.cwd;
  const originalExit = process.exit;
  const originalLog = console.log;

  beforeEach(() => {
    // 恢复默认值
    process.cwd = originalCwd;
    process.exit = originalExit;
    console.log = originalLog;
  });

  test("returns default values when no arguments provided", () => {
    process.cwd = () => "/test/dir";

    const result = parseArguments([]);

    expect(result.mode).toBe("both");
    expect(result.address).toBe("127.0.0.1");
    expect(result.port).toBeUndefined();
    expect(result.config).toBe("/test/dir/config.json");
    expect(result.workspace).toBe("/test/dir");
    expect(result.sandbox).toBe("/test/dir/sandbox");
    expect(result.serverUrl).toBe("");
  });

  test("parses --mode with valid 'tui' value", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments([
      "--mode",
      "tui",
      "--server-url",
      "http://127.0.0.1:8787",
    ]);
    expect(result.mode).toBe("tui");
  });

  test("parses --mode with valid 'server' value", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--mode", "server"]);
    expect(result.mode).toBe("server");
  });

  test("parses --mode with valid 'both' value", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--mode", "both"]);
    expect(result.mode).toBe("both");
  });

  test("defaults mode to 'both' for invalid values", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--mode", "invalid"]);
    expect(result.mode).toBe("both");
  });

  test("parses -m short flag for mode", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments([
      "-m",
      "tui",
      "--server-url",
      "http://127.0.0.1:8787",
    ]);
    expect(result.mode).toBe("tui");
  });

  test("throws when mode is tui without server url", () => {
    process.cwd = () => "/test/dir";

    expect(() => {
      parseArguments(["--mode", "tui"]);
    }).toThrow("TUI mode requires --server-url");
  });

  test("parses --config flag with absolute path", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--config", "/custom/config.json"]);
    expect(result.config).toBe("/custom/config.json");
  });

  test("parses -c short flag for config", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["-c", "custom.yaml"]);
    expect(result.config).toBe("custom.yaml");
  });

  test("parses --workspace with absolute path", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--workspace", "/my/workspace"]);
    expect(result.workspace).toBe("/my/workspace");
    expect(result.config).toBe("/my/workspace/config.json");
    expect(result.sandbox).toBe("/my/workspace/sandbox");
  });

  test("resolves --workspace with relative path", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--workspace", "./relative"]);
    expect(result.workspace).toBe("/test/dir/relative");
    expect(result.config).toBe("/test/dir/relative/config.json");
    expect(result.sandbox).toBe("/test/dir/relative/sandbox");
  });

  test("parses --sandbox flag", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--sandbox", "custom-sandbox"]);
    expect(result.sandbox).toBe("/test/dir/custom-sandbox");
  });

  test("parses --server-url flag", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--server-url", "http://127.0.0.1:8787"]);
    expect(result.serverUrl).toBe("http://127.0.0.1:8787");
  });

  test("throws when server-url uses websocket protocol", () => {
    process.cwd = () => "/test/dir";

    expect(() => {
      parseArguments(["--server-url", "ws://localhost:8787"]);
    }).toThrow("--server-url only supports http protocol");
  });

  test("throws when server-url uses https protocol", () => {
    process.cwd = () => "/test/dir";

    expect(() => {
      parseArguments(["--server-url", "https://localhost:8787"]);
    }).toThrow("--server-url only supports http protocol");
  });

  test("parses --address flag", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--address", "0.0.0.0"]);
    expect(result.address).toBe("0.0.0.0");
  });

  test("parses --port flag with valid number", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--port", "9090"]);
    expect(result.port).toBe(9090);
  });

  test("parses port with string value, converts to number", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments(["--port", "3000"]);
    expect(typeof result.port).toBe("number");
    expect(result.port).toBe(3000);
  });

  test("parses multiple arguments together", () => {
    process.cwd = () => "/test/dir";
    const result = parseArguments([
      "--mode",
      "server",
      "--address",
      "0.0.0.0",
      "--port",
      "3000",
      "--workspace",
      "/app/work",
      "--config",
      "/app/config.json",
    ]);

    expect(result.mode).toBe("server");
    expect(result.address).toBe("0.0.0.0");
    expect(result.port).toBe(3000);
    expect(result.workspace).toBe("/app/work");
    expect(result.config).toBe("/app/config.json");
  });

  test("calls process.exit when --version is provided", () => {
    let exitCalled = false;
    let exitCode: number | undefined;

    process.exit = ((code?: number) => {
      exitCalled = true;
      exitCode = code;
      throw new Error("exit called");
    }) as typeof process.exit;

    expect(() => {
      parseArguments(["--version"]);
    }).toThrow("exit called");

    expect(exitCalled).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("calls process.exit when -v is provided", () => {
    let exitCalled = false;

    process.exit = ((code?: number) => {
      exitCalled = true;
      throw new Error("exit called");
    }) as typeof process.exit;

    expect(() => {
      parseArguments(["-v"]);
    }).toThrow("exit called");

    expect(exitCalled).toBe(true);
  });

  test("calls process.exit when --help is provided", () => {
    let exitCalled = false;

    process.exit = ((code?: number) => {
      exitCalled = true;
      throw new Error("exit called");
    }) as typeof process.exit;

    expect(() => {
      parseArguments(["--help"]);
    }).toThrow("exit called");

    expect(exitCalled).toBe(true);
  });

  test("calls process.exit when -h is provided", () => {
    let exitCalled = false;

    process.exit = ((code?: number) => {
      exitCalled = true;
      throw new Error("exit called");
    }) as typeof process.exit;

    expect(() => {
      parseArguments(["-h"]);
    }).toThrow("exit called");

    expect(exitCalled).toBe(true);
  });
});

describe("parseArguments - real CLI tests via subprocess", () => {
  const helperScript = "tests/bootstrap/test-cli-helper.ts";

  test("runs helper script with no arguments", async () => {
    const result = await $`bun ${helperScript}`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.result.mode).toBe("both");
    expect(parsed.result.address).toBe("127.0.0.1");
    expect(parsed.result.port).toBeUndefined();
  });

  test("runs helper script with --version and captures exit", async () => {
    const result = await $`bun ${helperScript} --version`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.exitCalled).toBe(true);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.logOutput).toContain(version);
  });

  test("runs helper script with -v and captures exit", async () => {
    const result = await $`bun ${helperScript} -v`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.exitCalled).toBe(true);
    expect(parsed.logOutput).toContain(version);
  });

  test("runs helper script with --help and captures exit", async () => {
    const result = await $`bun ${helperScript} --help`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.exitCalled).toBe(true);
    expect(
      parsed.logOutput.some((log: string) => log.includes("Atom Next")),
    ).toBe(true);
  });

  test("runs helper script with -h and captures exit", async () => {
    const result = await $`bun ${helperScript} -h`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.exitCalled).toBe(true);
  });

  test("runs helper script with --mode server", async () => {
    const result = await $`bun ${helperScript} --mode server`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.result.mode).toBe("server");
  });

  test("runs helper script with --mode both", async () => {
    const result = await $`bun ${helperScript} --mode both`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.result.mode).toBe("both");
  });

  test("runs helper script with -m tui and --server-url", async () => {
    const result =
      await $`bun ${helperScript} -m tui --server-url http://127.0.0.1:8787`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.result.mode).toBe("tui");
    expect(parsed.result.serverUrl).toBe("http://127.0.0.1:8787");
  });

  test("fails helper script when tui mode misses server url", async () => {
    const result = await $`bun ${helperScript} --mode tui`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("TUI mode requires --server-url");
  });

  test("fails helper script when server-url uses websocket protocol", async () => {
    const result =
      await $`bun ${helperScript} --mode tui --server-url ws://localhost:8787`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("--server-url only supports http protocol");
  });

  test("fails helper script when server-url uses https protocol", async () => {
    const result =
      await $`bun ${helperScript} --mode tui --server-url https://localhost:8787`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("--server-url only supports http protocol");
  });

  test("runs helper script with custom port", async () => {
    const result = await $`bun ${helperScript} --port 9090`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.result.port).toBe(9090);
  });

  test("runs helper script with custom address", async () => {
    const result = await $`bun ${helperScript} --address 0.0.0.0`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.result.address).toBe("0.0.0.0");
  });

  test("runs helper script with config and workspace", async () => {
    const result =
      await $`bun ${helperScript} -c config.json --workspace /my/workspace`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.result.config).toBe("config.json");
    expect(parsed.result.workspace).toBe("/my/workspace");
  });

  test("runs helper script with workspace and uses workspace config by default", async () => {
    const result =
      await $`bun ${helperScript} --workspace /my/workspace`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.result.workspace).toBe("/my/workspace");
    expect(parsed.result.config).toBe("/my/workspace/config.json");
  });

  test("runs helper script with sandbox", async () => {
    const result =
      await $`bun ${helperScript} --sandbox custom-sandbox`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.result.sandbox).toContain("custom-sandbox");
  });

  test("runs helper script with multiple arguments", async () => {
    const result =
      await $`bun ${helperScript} --mode server --address 0.0.0.0 --port 3000 --workspace /app --config /app/config.yaml`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.success).toBe(true);
    expect(parsed.result.mode).toBe("server");
    expect(parsed.result.address).toBe("0.0.0.0");
    expect(parsed.result.port).toBe(3000);
    expect(parsed.result.workspace).toBe("/app");
    expect(parsed.result.config).toBe("/app/config.yaml");
  });
});
