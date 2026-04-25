import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { createPermissionPolicy } from "../permissions";
import type { ToolExecutionContext } from "../types";

type ReadToolInput = {
  filepath: string;
};

const isErrnoError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

/**
 * 把底层文件系统错误收口成稳定的工具错误文本。
 */
const mapReadError = (error: unknown) => {
  if (isErrnoError(error)) {
    if (error.code === "ENOENT") {
      return "The file does not exist, check filepath";
    }

    if (error.code === "EACCES" || error.code === "EPERM") {
      return "Permission denied: unable to read file";
    }

    if (error.code === "EISDIR") {
      return "Path is not a file";
    }
  }

  return error instanceof Error ? error.message : "read operation failed";
};

/**
 * 读取文件工具。
 * @description
 * v1 只支持绝对路径文件读取，返回逐行内容，方便模型继续引用。
 */
export const readTool = (context: ToolExecutionContext) =>
  ({
    description: "Read file content, include line number and content",
    inputSchema: z.object({
      filepath: z.string().describe("the absolute path of file"),
    }),
    execute: async ({ filepath }: ReadToolInput) => {
      const policy = createPermissionPolicy(context);
      const permissionResult = await policy.ensureReadableFile(filepath);

      if (!permissionResult.ok) {
        return {
          error: permissionResult.error,
        };
      }

      try {
        const fileStat = await stat(filepath);

        // 目录路径不允许走 read，避免和目录类工具职责重叠。
        if (!fileStat.isFile()) {
          return {
            error: "Path is not a file",
          };
        }

        const content = await readFile(filepath, "utf8");

        return {
          filepath,
          size: fileStat.size,
          content: content
            .split("\n")
            .map((line: string, idx: number) => [idx, line] as const),
        };
      } catch (error) {
        return {
          error: mapReadError(error),
        };
      }
    },
  });
