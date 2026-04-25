import { stat } from "node:fs/promises";
import { z } from "zod";
import { createPermissionPolicy } from "../permissions";
import type { ToolExecutionContext } from "../types";
import { validateBashCommandSafety } from "./bash-command-guard";

type BashToolInput = {
  cwd?: string;
  command: string;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
let bashAvailabilityCache: boolean | null = null;

const readSpawnOutput = async (stream: ReadableStream<Uint8Array> | null) => {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
};

const isErrnoError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const checkBashAvailable = async () => {
  if (bashAvailabilityCache !== null) {
    return bashAvailabilityCache;
  }

  try {
    const process = Bun.spawn(["bash", "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    bashAvailabilityCache = await process.exited === 0;
  } catch {
    bashAvailabilityCache = false;
  }

  return bashAvailabilityCache;
};

export const resetBashAvailabilityCacheForTest = () => {
  bashAvailabilityCache = null;
};

export const setBashAvailabilityCacheForTest = (value: boolean | null) => {
  bashAvailabilityCache = value;
};

const permissionDenied = () => ({
  error: "Permission denied: bash path not allowed",
});

const mapBashCwdError = (error: unknown) => {
  if (isErrnoError(error)) {
    if (error.code === "ENOENT") {
      return {
        error: "Invalid cwd",
        detail: "cwd directory does not exist",
      };
    }

    if (error.code === "ENOTDIR") {
      return {
        error: "Invalid cwd",
        detail: "cwd is not a directory",
      };
    }
  }

  return {
    error: "Invalid cwd",
    detail: error instanceof Error ? error.message : "invalid cwd",
  };
};

/**
 * bash once 工具。
 * @description
 * v1 只支持单次执行，不引入 session/query/kill 模式。
 */
export const bashTool = (context: ToolExecutionContext) =>
  ({
    description: "Run a single bash command in workspace or a workspace subdirectory",
    inputSchema: z.object({
      cwd: z.string().optional().describe("absolute working directory path, defaults to tool workspace"),
      command: z.string().min(1).describe("bash command string"),
      timeoutMs: z.number().int().positive().optional().describe("command timeout in ms, default 30000"),
    }),
    execute: async ({ cwd, command, timeoutMs = DEFAULT_TIMEOUT_MS }: BashToolInput) => {
      const policy = createPermissionPolicy(context);
      const workingDir = cwd ?? context.workspace;

      const permissionResult = await policy.ensureBashDirectory(workingDir);

      if (!permissionResult.ok) {
        return permissionDenied();
      }

      try {
        const cwdStat = await stat(workingDir);

        if (!cwdStat.isDirectory()) {
          return {
            error: "Invalid cwd",
            detail: "cwd is not a directory",
          };
        }
      } catch (error) {
        return mapBashCwdError(error);
      }

      const safety = validateBashCommandSafety(command);

      if (!safety.ok) {
        return {
          error: "Command blocked by builtin safety policy",
          ruleId: safety.ruleId,
          detail: safety.message,
        };
      }

      if (await policy.hasSensitivePathReference(command, workingDir)) {
        return {
          error: "Permission denied: bash command references protected path",
        };
      }

      if (!(await checkBashAvailable())) {
        return {
          error: "bash command is not available in runtime environment",
        };
      }

      const startedAt = Date.now();

      try {
        const process = Bun.spawn(["bash", "-lc", command], {
          cwd: workingDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          process.kill();
        }, timeoutMs);

        const [exitCode, stdout, stderr] = await Promise.all([
          process.exited,
          readSpawnOutput(process.stdout),
          readSpawnOutput(process.stderr),
        ]).finally(() => {
          clearTimeout(timer);
        });

        if (timedOut) {
          return {
            cwd: workingDir,
            command,
            success: false,
            exitCode: -1,
            stdout,
            stderr,
            durationMs: Date.now() - startedAt,
            method: "builtin.exec",
            error: `bash command timed out after ${timeoutMs}ms`,
          };
        }

        return {
          cwd: workingDir,
          command,
          success: exitCode === 0,
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          method: "builtin.exec",
          ...(exitCode === 0 ? {} : { error: stderr || `Command exited with code ${exitCode}` }),
        };
      } catch (error) {
        return {
          cwd: workingDir,
          command,
          success: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          durationMs: Date.now() - startedAt,
          method: "builtin.exec",
          error: error instanceof Error ? error.message : "bash command failed",
        };
      }
    },
  });
