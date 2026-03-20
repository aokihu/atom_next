import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { collectEnvFiles, parseEnvFiles } from "@/bootstrap/env";

const PLAYGROUND_DIR = join(process.cwd(), "Playground");
const ENV_FILE_NAMES = [".env", ".env.local", ".env.dev"];

describe("env module", () => {
  beforeEach(() => {
    // 清理所有测试环境文件
    ENV_FILE_NAMES.forEach((fileName) => {
      const filePath = join(PLAYGROUND_DIR, fileName);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    });
  });

  afterEach(() => {
    // 确保测试后清理所有文件
    ENV_FILE_NAMES.forEach((fileName) => {
      const filePath = join(PLAYGROUND_DIR, fileName);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    });
  });

  describe("collectEnvFiles", () => {
    test("returns empty array when no env files exist", () => {
      const files = collectEnvFiles(PLAYGROUND_DIR);
      expect(files).toEqual([]);
    });

    test("finds .env file when it exists", () => {
      const envPath = join(PLAYGROUND_DIR, ".env");
      writeFileSync(envPath, "TEST_KEY=test_value");

      const files = collectEnvFiles(PLAYGROUND_DIR);
      expect(files).toContain(envPath);
    });

    test("finds .env.local file when it exists", () => {
      const envPath = join(PLAYGROUND_DIR, ".env.local");
      writeFileSync(envPath, "LOCAL_KEY=local_value");

      const files = collectEnvFiles(PLAYGROUND_DIR);
      expect(files).toContain(envPath);
    });

    test("finds .env.dev file when it exists", () => {
      const envPath = join(PLAYGROUND_DIR, ".env.dev");
      writeFileSync(envPath, "DEV_KEY=dev_value");

      const files = collectEnvFiles(PLAYGROUND_DIR);
      expect(files).toContain(envPath);
    });

    test("finds all three env files when they exist", () => {
      const envPath = join(PLAYGROUND_DIR, ".env");
      const envLocalPath = join(PLAYGROUND_DIR, ".env.local");
      const envDevPath = join(PLAYGROUND_DIR, ".env.dev");

      writeFileSync(envPath, "KEY1=value1");
      writeFileSync(envLocalPath, "KEY2=value2");
      writeFileSync(envDevPath, "KEY3=value3");

      const files = collectEnvFiles(PLAYGROUND_DIR);
      expect(files).toContain(envPath);
      expect(files).toContain(envLocalPath);
      expect(files).toContain(envDevPath);
    });

    test("returns files in correct order: .env, .env.local, .env.dev", () => {
      const envPath = join(PLAYGROUND_DIR, ".env");
      const envLocalPath = join(PLAYGROUND_DIR, ".env.local");
      const envDevPath = join(PLAYGROUND_DIR, ".env.dev");

      writeFileSync(envPath, "KEY1=value1");
      writeFileSync(envLocalPath, "KEY2=value2");
      writeFileSync(envDevPath, "KEY3=value3");

      const files = collectEnvFiles(PLAYGROUND_DIR);
      expect(files[0]).toBe(envPath);
      expect(files[1]).toBe(envLocalPath);
      expect(files[2]).toBe(envDevPath);
    });
  });

  describe("parseEnvFiles", () => {
    test("returns empty object when no env files exist", () => {
      const result = parseEnvFiles(PLAYGROUND_DIR);
      expect(result).toEqual({});
    });

    test("parses single .env file correctly", () => {
      const envPath = join(PLAYGROUND_DIR, ".env");
      writeFileSync(
        envPath,
        `
API_KEY=test123
DATABASE_URL=postgres://localhost:5432/db
DEBUG=true
      `.trim(),
      );

      const result = parseEnvFiles(PLAYGROUND_DIR);
      expect(result.API_KEY).toBe("test123");
      expect(result.DATABASE_URL).toBe("postgres://localhost:5432/db");
      expect(result.DEBUG).toBe("true");
    });

    test("parses multiple env files with override", () => {
      const envPath = join(PLAYGROUND_DIR, ".env");
      const envLocalPath = join(PLAYGROUND_DIR, ".env.local");

      writeFileSync(
        envPath,
        `
COMMON_KEY=from_env
ENV_ONLY=only_in_env
      `.trim(),
      );

      writeFileSync(
        envLocalPath,
        `
COMMON_KEY=from_local
LOCAL_ONLY=only_in_local
      `.trim(),
      );

      const result = parseEnvFiles(PLAYGROUND_DIR);
      expect(result.COMMON_KEY).toBe("from_local");
      expect(result.ENV_ONLY).toBe("only_in_env");
      expect(result.LOCAL_ONLY).toBe("only_in_local");
    });

    test("parses all three env files with correct override order", () => {
      const envPath = join(PLAYGROUND_DIR, ".env");
      const envLocalPath = join(PLAYGROUND_DIR, ".env.local");
      const envDevPath = join(PLAYGROUND_DIR, ".env.dev");

      writeFileSync(
        envPath,
        `
SHARED_KEY=from_env
ENV_KEY=env_value
      `.trim(),
      );

      writeFileSync(
        envLocalPath,
        `
SHARED_KEY=from_local
LOCAL_KEY=local_value
      `.trim(),
      );

      writeFileSync(
        envDevPath,
        `
SHARED_KEY=from_dev
DEV_KEY=dev_value
      `.trim(),
      );

      const result = parseEnvFiles(PLAYGROUND_DIR);
      expect(result.SHARED_KEY).toBe("from_dev");
      expect(result.ENV_KEY).toBe("env_value");
      expect(result.LOCAL_KEY).toBe("local_value");
      expect(result.DEV_KEY).toBe("dev_value");
    });

    test("handles comments and empty lines in env files", () => {
      const envPath = join(PLAYGROUND_DIR, ".env");
      writeFileSync(
        envPath,
        `
# 这是一个注释
VALID_KEY=valid_value

# 另一个注释
ANOTHER_KEY=another_value

# 空行上面的注释
      `.trim(),
      );

      const result = parseEnvFiles(PLAYGROUND_DIR);
      expect(result.VALID_KEY).toBe("valid_value");
      expect(result.ANOTHER_KEY).toBe("another_value");
    });

    test("handles quoted values in env files", () => {
      const envPath = join(PLAYGROUND_DIR, ".env");
      writeFileSync(
        envPath,
        `
SINGLE_QUOTE='single quoted value'
DOUBLE_QUOTE="double quoted value"
NO_QUOTE=no_quotes
      `.trim(),
      );

      const result = parseEnvFiles(PLAYGROUND_DIR);
      expect(result.SINGLE_QUOTE).toBe("single quoted value");
      expect(result.DOUBLE_QUOTE).toBe("double quoted value");
      expect(result.NO_QUOTE).toBe("no_quotes");
    });

    test("does not pollute process.env", () => {
      const originalEnv = { ...process.env };

      const envPath = join(PLAYGROUND_DIR, ".env");
      writeFileSync(envPath, "SHOULD_NOT_BE_IN_PROCESS_ENV=test_value");

      parseEnvFiles(PLAYGROUND_DIR);

      expect(process.env.SHOULD_NOT_BE_IN_PROCESS_ENV).toBeUndefined();

      for (const key in originalEnv) {
        expect(process.env[key]).toBe(originalEnv[key]);
      }
    });
  });
});
