import { cp as copyPath, rename, rm, stat } from "node:fs/promises";
import { z } from "zod";
import { createPermissionPolicy } from "../permissions";
import type { ToolExecutionContext } from "../types";

type MvToolInput = {
  source: string;
  destination: string;
  overwrite?: boolean;
};

const isErrnoError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const mapMoveError = (error: unknown) => {
  if (isErrnoError(error)) {
    if (error.code === "ENOENT") {
      return "Source path does not exist";
    }

    if (error.code === "EEXIST") {
      return "Destination already exists, set overwrite=true to replace";
    }

    if (error.code === "EACCES" || error.code === "EPERM") {
      return "Permission denied: unable to move path";
    }
  }

  return error instanceof Error ? error.message : "mv operation failed";
};

/**
 * 移动文件或目录。
 * @description
 * 优先使用 rename，跨设备时退回 copy + remove。
 */
export const mvTool = (context: ToolExecutionContext) =>
  ({
    description: "Move file or directory inside workspace",
    inputSchema: z.object({
      source: z.string().describe("the absolute source path"),
      destination: z.string().describe("the absolute destination path"),
      overwrite: z.boolean().optional().describe("overwrite destination when true"),
    }),
    execute: async ({
      source,
      destination,
      overwrite = false,
    }: MvToolInput) => {
      const policy = createPermissionPolicy(context);
      const permissionResult = await policy.ensureMovePaths(source, destination);

      if (!permissionResult.ok) {
        return {
          error: permissionResult.error,
        };
      }

      try {
        await stat(source);
      } catch (error) {
        return {
          error: mapMoveError(error),
        };
      }

      try {
        if (overwrite) {
          await rm(destination, { recursive: true, force: true });
        } else {
          try {
            await stat(destination);
            return {
              error: "Destination already exists, set overwrite=true to replace",
            };
          } catch {
            // destination missing, continue
          }
        }

        try {
          await rename(source, destination);
        } catch (error) {
          if (!isErrnoError(error) || error.code !== "EXDEV") {
            throw error;
          }

          await copyPath(source, destination, {
            recursive: true,
            force: overwrite,
            errorOnExist: !overwrite,
          });
          await rm(source, { recursive: true, force: true });
        }

        return {
          success: true,
          source,
          destination,
          overwrite,
          method: "builtin.fs",
        };
      } catch (error) {
        return {
          error: mapMoveError(error),
        };
      }
    },
  });
