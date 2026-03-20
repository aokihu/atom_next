// @ts-nocheck
import { describe, expect, test, beforeEach } from "bun:test";
import { $ } from "bun";
import { parseArguments, type ParsedArguments } from "@/bootstrap/cli";

describe("parseArguments - direct function tests", () => {
  test("returns default values when no arguments provided", () => {
    // 测试直接调用函数，传入模拟的 argv
    const result = parseArguments(["bun", "script"]);

    expect(result.version).toBe(false);
    expect(result.help).toBe(false);
    expect(result.mode).toBe("default");
    expect(result.address).toBe("127.0.0.1");
    expect(result.port).toBe(8787);
    expect(result.config).toBeUndefined();
    expect(result.workspace).toBeUndefined();
    expect(result.sandbox).toBeUndefined();
    expect(result.serverUrl).toBeUndefined();
  });

  test("parses --version and -v flags", () => {
    const result1 = parseArguments(["bun", "script", "--version"]);
    expect(result1.version).toBe(true);

    const result2 = parseArguments(["bun", "script", "-v"]);
    expect(result2.version).toBe(true);
  });

  test("parses --help and -h flags", () => {
    const result1 = parseArguments(["bun", "script", "--help"]);
    expect(result1.help).toBe(true);

    const result2 = parseArguments(["bun", "script", "-h"]);
    expect(result2.help).toBe(true);
  });

  test("parses --mode and -m with valid values", () => {
    const result1 = parseArguments(["bun", "script", "--mode", "tui"]);
    expect(result1.mode).toBe("tui");

    const result2 = parseArguments(["bun", "script", "-m", "server"]);
    expect(result2.mode).toBe("server");

    const result3 = parseArguments(["bun", "script", "--mode", "both"]);
    expect(result3.mode).toBe("default");
  });

  test("throws error for invalid mode", () => {
    expect(() => {
      parseArguments(["bun", "script", "--mode", "invalid"]);
    }).toThrow("Invalid mode: invalid. Must be 'tui', 'server', or 'both'");
  });

  test("parses --config and -c flags", () => {
    const result1 = parseArguments([
      "bun",
      "script",
      "--config",
      "/path/to/config.json",
    ]);
    expect(result1.config).toBe("/path/to/config.json");

    const result2 = parseArguments(["bun", "script", "-c", "config.yaml"]);
    expect(result2.config).toBe("config.yaml");
  });

  test("parses --workspace and -w flags", () => {
    const result1 = parseArguments([
      "bun",
      "script",
      "--workspace",
      "/my/workspace",
    ]);
    expect(result1.workspace).toBe("/my/workspace");

    const result2 = parseArguments(["bun", "script", "-w", "./work"]);
    expect(result2.workspace).toBe("./work");
  });

  test("parses --sandbox flag", () => {
    const result = parseArguments([
      "bun",
      "script",
      "--sandbox",
      "/custom/sandbox",
    ]);
    expect(result.sandbox).toBe("/custom/sandbox");
  });

  test("parses --server-url flag", () => {
    const result = parseArguments([
      "bun",
      "script",
      "--server-url",
      "ws://localhost:8787",
    ]);
    expect(result.serverUrl).toBe("ws://localhost:8787");
  });

  test("parses --address flag", () => {
    const result = parseArguments(["bun", "script", "--address", "0.0.0.0"]);
    expect(result.address).toBe("0.0.0.0");
  });

  test("parses --port flag with valid number", () => {
    const result = parseArguments(["bun", "script", "--port", "9090"]);
    expect(result.port).toBe(9090);
  });

  test("throws error for invalid port", () => {
    expect(() => {
      parseArguments(["bun", "script", "--port", "99999"]);
    }).toThrow("Invalid port: 99999. Must be a number between 1 and 65535");

    expect(() => {
      parseArguments(["bun", "script", "--port", "0"]);
    }).toThrow("Invalid port: 0. Must be a number between 1 and 65535");

    expect(() => {
      parseArguments(["bun", "script", "--port", "not-a-number"]);
    }).toThrow(
      "Invalid port: not-a-number. Must be a number between 1 and 65535",
    );
  });

  test("throws error when mode is tui without server-url", () => {
    expect(() => {
      parseArguments(["bun", "script", "--mode", "tui"]);
    }).toThrow("Mode 'tui' requires --server-url to be specified");
  });

  test("accepts mode tui with server-url", () => {
    const result = parseArguments([
      "bun",
      "script",
      "--mode",
      "tui",
      "--server-url",
      "ws://localhost:8787",
    ]);
    expect(result.mode).toBe("tui");
    expect(result.serverUrl).toBe("ws://localhost:8787");
  });

  test("parses multiple arguments together", () => {
    const result = parseArguments([
      "bun",
      "script",
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

  test("parses short flags together", () => {
    const result = parseArguments([
      "bun",
      "script",
      "-v",
      "-h",
      "-m",
      "server",
      "-c",
      "config.json",
      "-w",
      "./workspace",
    ]);

    expect(result.version).toBe(true);
    expect(result.help).toBe(true);
    expect(result.mode).toBe("server");
    expect(result.config).toBe("config.json");
    expect(result.workspace).toBe("./workspace");
  });
});

describe("parseArguments - real CLI tests via subprocess", () => {
  const helperScript = "tests/bootstrap/test-cli-helper.ts";

  test("runs helper script with no arguments", async () => {
    const result = await $`bun ${helperScript}`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.version).toBe(false);
    expect(parsed.help).toBe(false);
    expect(parsed.mode).toBe("both");
    expect(parsed.address).toBe("127.0.0.1");
    expect(parsed.port).toBe(8787);
  });

  test("runs helper script with --version", async () => {
    const result = await $`bun ${helperScript} --version`.quiet();
    const parsed = JSON.parse(result.stdout as string);
    expect(parsed.version).toBe(true);
  });

  test("runs helper script with -v", async () => {
    const result = await $`bun ${helperScript} -v`.quiet();
    const parsed = JSON.parse(result.stdout as string);
    expect(parsed.version).toBe(true);
  });

  test("runs helper script with --help", async () => {
    const result = await $`bun ${helperScript} --help`.quiet();
    const parsed = JSON.parse(result.stdout as string);
    expect(parsed.help).toBe(true);
  });

  test("runs helper script with -h", async () => {
    const result = await $`bun ${helperScript} -h`.quiet();
    const parsed = JSON.parse(result.stdout as string);
    expect(parsed.help).toBe(true);
  });

  test("runs helper script with --mode server", async () => {
    const result = await $`bun ${helperScript} --mode server`.quiet();
    const parsed = JSON.parse(result.stdout as string);
    expect(parsed.mode).toBe("server");
  });

  test("runs helper script with -m tui and --server-url", async () => {
    const result =
      await $`bun ${helperScript} -m tui --server-url ws://localhost:8787`.quiet();
    const parsed = JSON.parse(result.stdout as string);
    expect(parsed.mode).toBe("tui");
    expect(parsed.serverUrl).toBe("ws://localhost:8787");
  });

  test("runs helper script with custom port", async () => {
    const result = await $`bun ${helperScript} --port 9090`.quiet();
    const parsed = JSON.parse(result.stdout as string);
    expect(parsed.port).toBe(9090);
  });

  test("runs helper script with custom address", async () => {
    const result = await $`bun ${helperScript} --address 0.0.0.0`.quiet();
    const parsed = JSON.parse(result.stdout as string);
    expect(parsed.address).toBe("0.0.0.0");
  });

  test("runs helper script with config and workspace", async () => {
    const result =
      await $`bun ${helperScript} -c config.json -w /my/workspace`.quiet();
    const parsed = JSON.parse(result.stdout as string);
    expect(parsed.config).toBe("config.json");
    expect(parsed.workspace).toBe("/my/workspace");
  });

  test("runs helper script with sandbox", async () => {
    const result =
      await $`bun ${helperScript} --sandbox /custom/sandbox`.quiet();
    const parsed = JSON.parse(result.stdout as string);
    expect(parsed.sandbox).toBe("/custom/sandbox");
  });

  test("runs helper script with multiple arguments", async () => {
    const result =
      await $`bun ${helperScript} --mode server --address 0.0.0.0 --port 3000 --workspace /app --config /app/config.yaml`.quiet();
    const parsed = JSON.parse(result.stdout as string);

    expect(parsed.mode).toBe("server");
    expect(parsed.address).toBe("0.0.0.0");
    expect(parsed.port).toBe(3000);
    expect(parsed.workspace).toBe("/app");
    expect(parsed.config).toBe("/app/config.yaml");
  });

  test("helper script throws error for invalid mode", async () => {
    const result = $`bun ${helperScript} --mode invalid`.quiet();
    expect(result).rejects.toThrow();
  });

  test("helper script throws error for tui mode without server-url", async () => {
    const result = $`bun ${helperScript} --mode tui`.quiet();
    expect(result).rejects.toThrow();
  });

  test("helper script throws error for invalid port", async () => {
    const result = $`bun ${helperScript} --port 99999`.quiet();
    expect(result).rejects.toThrow();
  });
});
