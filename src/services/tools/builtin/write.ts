import { appendFile, stat, writeFile } from "node:fs/promises";
import { z } from "zod";
import { createPermissionPolicy } from "../permissions";
import type { ToolExecutionContext } from "../types";

type WriteToolInput = {
  filepath: string;
  content: string;
  append?: boolean;
};

const isErrnoError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

/**
 * 统一映射写文件错误。
 */
const mapWriteError = (error: unknown) => {
  if (isErrnoError(error)) {
    if (error.code === "ENOENT") {
      return "Parent directory does not exist";
    }

    if (error.code === "EISDIR") {
      return "Path is a directory";
    }

    if (error.code === "EACCES" || error.code === "EPERM") {
      return "Permission denied: unable to write file";
    }
  }

  return error instanceof Error ? error.message : "write operation failed";
};

/**
 * 写文件工具。
 * @description
 * v1 只支持纯文本写入，不自动创建缺失父目录。
 */
export const writeTool = (context: ToolExecutionContext) =>
  ({
    description: "Write or append text content to a file inside workspace",
    inputSchema: z.object({
      filepath: z.string().describe("the absolute path of a file inside the current workspace"),
      content: z.string().describe("the text content to write"),
      append: z.boolean().optional().describe("append content when true"),
    }),
    execute: async ({ filepath, content, append = false }: WriteToolInput) => {
      const policy = createPermissionPolicy(context);
      const permissionResult = await policy.ensureWritableFile(filepath);

      if (!permissionResult.ok) {
        return {
          error: permissionResult.error,
        };
      }

      try {
        if (append) {
          await appendFile(filepath, content, "utf8");
        } else {
          await writeFile(filepath, content, "utf8");
        }

        const fileStat = await stat(filepath);

        return {
          success: true,
          filepath,
          bytes: fileStat.size,
          append,
          method: "builtin.fs",
        };
      } catch (error) {
        return {
          error: mapWriteError(error),
        };
      }
    },
  });
