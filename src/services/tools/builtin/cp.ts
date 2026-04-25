import { cp as copyPath, stat } from "node:fs/promises";
import { z } from "zod";
import { createPermissionPolicy } from "../permissions";
import type { ToolExecutionContext } from "../types";

type CpToolInput = {
  source: string;
  destination: string;
  recursive?: boolean;
  overwrite?: boolean;
};

const isErrnoError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const mapCopyError = (error: unknown) => {
  if (isErrnoError(error)) {
    if (error.code === "ENOENT") {
      return "Source path does not exist";
    }

    if (error.code === "ENOTDIR") {
      return "Directory copy requires recursive=true";
    }

    if (error.code === "EEXIST") {
      return "Destination already exists, set overwrite=true to replace";
    }

    if (error.code === "EACCES" || error.code === "EPERM") {
      return "Permission denied: unable to copy path";
    }
  }

  return error instanceof Error ? error.message : "cp operation failed";
};

/**
 * 复制文件或目录。
 * @description
 * v1 保持最小参数面，只支持显式 recursive / overwrite。
 */
export const cpTool = (context: ToolExecutionContext) =>
  ({
    description: "Copy file or directory inside workspace",
    inputSchema: z.object({
      source: z.string().describe("the absolute source path"),
      destination: z.string().describe("the absolute destination path"),
      recursive: z.boolean().optional().describe("copy directories recursively when true"),
      overwrite: z.boolean().optional().describe("overwrite destination when true"),
    }),
    execute: async ({
      source,
      destination,
      recursive = false,
      overwrite = false,
    }: CpToolInput) => {
      const policy = createPermissionPolicy(context);
      const permissionResult = await policy.ensureCopyPaths(source, destination);

      if (!permissionResult.ok) {
        return {
          error: permissionResult.error,
        };
      }

      try {
        const sourceStat = await stat(source);

        if (sourceStat.isDirectory() && !recursive) {
          return {
            error: "Source is a directory, set recursive=true to copy directories",
          };
        }

        await copyPath(source, destination, {
          recursive,
          force: overwrite,
          errorOnExist: !overwrite,
        });

        return {
          success: true,
          source,
          destination,
          recursive,
          overwrite,
          method: "builtin.fs",
        };
      } catch (error) {
        return {
          error: mapCopyError(error),
        };
      }
    },
  });
