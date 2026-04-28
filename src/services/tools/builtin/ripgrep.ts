import { z } from "zod";
import { createPermissionPolicy } from "../permissions";
import type { ToolExecutionContext } from "../types";

type RipgrepToolInput = {
  dirpath: string;
  pattern: string;
  caseSensitive?: boolean;
  fileGlob?: string;
};

type BuildRipgrepArgsInput = {
  dirpath: string;
  pattern: string;
  caseSensitive?: boolean;
  fileGlob?: string;
};

/**
 * 构造 rg 参数列表。
 * @description
 * v1 先只支持最小参数面，避免过早把 ripgrep 变成完整命令封装。
 */
export const buildRipgrepArgs = ({
  dirpath,
  pattern,
  caseSensitive = false,
  fileGlob,
}: BuildRipgrepArgsInput) => {
  const args: string[] = [];

  if (!caseSensitive) {
    args.push("-i");
  }

  if (fileGlob) {
    args.push("-g", fileGlob);
  }

  args.push(pattern, dirpath);
  return args;
};

/**
 * 读取 Bun.spawn 的输出流。
 */
const readSpawnOutput = async (stream: ReadableStream<Uint8Array> | null) => {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
};

const isErrnoError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

/**
 * 统一映射 rg 执行失败。
 */
const mapRipgrepError = (error: unknown) => {
  if (isErrnoError(error) && error.code === "ENOENT") {
    return "rg command is not available in runtime environment";
  }

  return error instanceof Error ? error.message : "ripgrep command failed";
};

/**
 * ripgrep 工具。
 * @description
 * 无匹配时返回空 output，而不是 error。
 * 这样模型可以把“没搜到”当作正常信息继续推理。
 */
export const ripgrepTool = (context: ToolExecutionContext) =>
  ({
    description: "Search file content in directory by using ripgrep",
    inputSchema: z.object({
      dirpath: z.string().describe("the absolute path of a directory inside the current workspace"),
      pattern: z.string().describe("search pattern used by rg"),
      caseSensitive: z.boolean().optional().describe("use case-sensitive matching when true"),
      fileGlob: z.string().optional().describe("optional glob for filtering files, e.g. *.ts"),
    }),
    execute: async ({ dirpath, pattern, caseSensitive = false, fileGlob }: RipgrepToolInput) => {
      const policy = createPermissionPolicy(context);
      const permissionResult = await policy.ensureReadableDirectory(dirpath, "ripgrep");

      if (!permissionResult.ok) {
        return {
          error: permissionResult.error,
        };
      }

      const args = buildRipgrepArgs({
        dirpath,
        pattern,
        caseSensitive,
        fileGlob,
      });
      const command = ["rg", ...args].join(" ");

      try {
        const process = Bun.spawn(["rg", ...args], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const [output, stderr, exitCode] = await Promise.all([
          readSpawnOutput(process.stdout),
          readSpawnOutput(process.stderr),
          process.exited,
        ]);

        // rg 无命中返回 exit 1，这里按成功空结果处理。
        if (exitCode === 1 && stderr.trim() === "") {
          return {
            dirpath,
            pattern,
            command,
            output: "",
          };
        }

        if (exitCode !== 0) {
          return {
            error: stderr.trim() || `rg command failed (exit ${exitCode})`,
            command,
          };
        }

        return {
          dirpath,
          pattern,
          command,
          output,
        };
      } catch (error) {
        return {
          error: mapRipgrepError(error),
          command,
        };
      }
    },
  });
