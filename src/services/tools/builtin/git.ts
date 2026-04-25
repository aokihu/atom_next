import { z } from "zod";
import { createPermissionPolicy } from "../permissions";
import type { ToolExecutionContext } from "../types";

type GitToolInput = {
  cwd: string;
  subcommand: string;
  args?: string[];
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const GIT_SUBCOMMAND_PATTERN = /^[A-Za-z0-9._-]+$/;
let gitAvailabilityCache: boolean | null = null;

const readSpawnOutput = async (stream: ReadableStream<Uint8Array> | null) => {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
};

const checkGitAvailable = async () => {
  if (gitAvailabilityCache !== null) {
    return gitAvailabilityCache;
  }

  try {
    const process = Bun.spawn(["git", "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    gitAvailabilityCache = await process.exited === 0;
  } catch {
    gitAvailabilityCache = false;
  }

  return gitAvailabilityCache;
};

export const resetGitAvailabilityCacheForTest = () => {
  gitAvailabilityCache = null;
};

export const setGitAvailabilityCacheForTest = (value: boolean | null) => {
  gitAvailabilityCache = value;
};

/**
 * git CLI 工具。
 * @description
 * v1 只运行单次 git 子命令，不引入交互式会话。
 */
export const gitTool = (context: ToolExecutionContext) =>
  ({
    description: "Run git subcommand in a workspace directory",
    inputSchema: z.object({
      cwd: z.string().describe("the absolute path used as git working directory"),
      subcommand: z.string().describe("git subcommand, e.g. status/log/diff"),
      args: z.array(z.string()).optional().describe("additional git args as string array"),
      timeoutMs: z.number().int().positive().optional().describe("command timeout in ms, default 30000"),
    }),
    execute: async ({
      cwd,
      subcommand,
      args = [],
      timeoutMs = DEFAULT_TIMEOUT_MS,
    }: GitToolInput) => {
      const policy = createPermissionPolicy(context);
      const permissionResult = await policy.ensureGitDirectory(cwd);

      if (!permissionResult.ok) {
        return {
          error: permissionResult.error,
        };
      }

      if (!GIT_SUBCOMMAND_PATTERN.test(subcommand)) {
        return {
          error: "Invalid git subcommand",
        };
      }

      const commandArgs = ["git", subcommand, ...args];
      const command = commandArgs.join(" ");

      if (await policy.hasSensitivePathReference(command, cwd)) {
        return {
          error: "Permission denied: git command references protected path",
        };
      }

      if (!(await checkGitAvailable())) {
        return {
          error: "git command is not available in runtime environment",
          hint: "Install git in the runtime environment or remove git tool usage.",
        };
      }

      const startedAt = Date.now();

      try {
        const process = Bun.spawn(commandArgs, {
          cwd,
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
            cwd,
            command,
            success: false,
            exitCode: -1,
            stdout,
            stderr,
            durationMs: Date.now() - startedAt,
            method: "builtin.exec",
            error: `git command timed out after ${timeoutMs}ms`,
          };
        }

        return {
          cwd,
          command,
          success: exitCode === 0,
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          method: "builtin.exec",
          ...(exitCode === 0 ? {} : { error: stderr || `git command failed (exit ${exitCode})` }),
        };
      } catch (error) {
        return {
          cwd,
          command,
          success: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          durationMs: Date.now() - startedAt,
          method: "builtin.exec",
          error: error instanceof Error ? error.message : "git command failed",
        };
      }
    },
  });
