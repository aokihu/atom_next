import { readdir, readlink, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { createPermissionPolicy, type PermissionPolicy } from "../permissions";
import type { ToolExecutionContext } from "../types";

type TreeToolInput = {
  dirpath: string;
  level?: number;
  all?: boolean;
};

type TreeCounts = {
  directories: number;
  files: number;
};

/**
 * tree 输出默认目录优先、同类按名称排序。
 */
const sortEntries = (entries: Dirent[]) =>
  [...entries].sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });

const formatSummary = ({ directories, files }: TreeCounts) => {
  const directoryLabel = directories === 1 ? "directory" : "directories";
  const fileLabel = files === 1 ? "file" : "files";
  return `${directories} ${directoryLabel}, ${files} ${fileLabel}`;
};

/**
 * 生成单个 tree 节点显示名。
 */
const formatEntryName = async (entry: Dirent, fullPath: string) => {
  if (entry.isDirectory()) {
    return `${entry.name}/`;
  }

  if (entry.isSymbolicLink()) {
    try {
      const target = await readlink(fullPath);
      return `${entry.name} -> ${target}`;
    } catch {
      return `${entry.name} -> [unreadable]`;
    }
  }

  return entry.name;
};

/**
 * 深度优先遍历目录树。
 * @description
 * 这里对子目录再次做权限判断，避免 workspace 内合法目录中
 * 出现指向外部的 symlink 后被继续向下展开。
 */
const walkTree = async (
  policy: PermissionPolicy,
  dirpath: string,
  depth: number,
  level: number | undefined,
  all: boolean,
  prefix: string,
  counts: TreeCounts,
): Promise<string[]> => {
  let entries = await readdir(dirpath, { withFileTypes: true });

  if (!all) {
    entries = entries.filter((entry) => !entry.name.startsWith("."));
  }

  entries = sortEntries(entries);

  const lines: string[] = [];

  for (const [index, entry] of entries.entries()) {
    const isLast = index === entries.length - 1;
    const connector = isLast ? "`-- " : "|-- ";
    const childPrefix = `${prefix}${isLast ? "    " : "|   "}`;
    const fullPath = join(dirpath, entry.name);
    const displayName = await formatEntryName(entry, fullPath);

    if (entry.isDirectory()) {
      const childAllowed = await policy.canReadTree(fullPath);

      counts.directories += 1;
      lines.push(`${prefix}${connector}${displayName}`);

      // 子目录如果越界，直接在 tree 中显示错误节点，而不是静默跳过。
      if (!childAllowed) {
        lines.push(`${childPrefix}\`-- [error: Permission denied: tree path not allowed]`);
        continue;
      }

      const shouldDescend = level === undefined || depth < level;

      if (shouldDescend) {
        try {
          const childLines = await walkTree(
            policy,
            fullPath,
            depth + 1,
            level,
            all,
            childPrefix,
            counts,
          );
          lines.push(...childLines);
        } catch (error) {
          const message = error instanceof Error ? error.message : "failed to read directory";
          lines.push(`${childPrefix}\`-- [error: ${message}]`);
        }
      }

      continue;
    }

    counts.files += 1;
    lines.push(`${prefix}${connector}${displayName}`);
  }

  return lines;
};

const isErrnoError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

/**
 * 统一映射 tree 顶层错误。
 */
const mapTreeError = (error: unknown) => {
  if (isErrnoError(error)) {
    if (error.code === "ENOENT") {
      return "Directory path does not exist";
    }

    if (error.code === "ENOTDIR") {
      return "Path is not a directory";
    }

    if (error.code === "EACCES" || error.code === "EPERM") {
      return "Permission denied: unable to read directory";
    }
  }

  return error instanceof Error ? error.message : "tree operation failed";
};

/**
 * 目录树工具。
 */
export const treeTool = (context: ToolExecutionContext) =>
  ({
    description: "Show directory tree using built-in filesystem traversal",
    inputSchema: z.object({
      dirpath: z.string().describe("the absolute path of directory"),
      level: z.number().int().positive().optional().describe("max display depth"),
      all: z.boolean().optional().describe("list hidden files when true"),
    }),
    execute: async ({ dirpath, level, all = false }: TreeToolInput) => {
      const policy = createPermissionPolicy(context);
      const permissionResult = await policy.ensureReadableDirectory(dirpath, "tree");

      if (!permissionResult.ok) {
        return {
          error: permissionResult.error,
        };
      }

      const command = ["tree", all ? "-a" : "", level ? `-L ${level}` : "", dirpath]
        .filter(Boolean)
        .join(" ");

      try {
        const dirStat = await stat(dirpath);

        // tree 只接受目录，空目录也按成功结果返回。
        if (!dirStat.isDirectory()) {
          return {
            error: "Path is not a directory",
            command,
          };
        }

        const counts: TreeCounts = {
          directories: 0,
          files: 0,
        };
        const lines = await walkTree(policy, dirpath, 1, level, all, "", counts);
        const result = [...[dirpath], ...lines, formatSummary(counts)].join("\n");

        return {
          dirpath,
          command,
          output: `${result}\n`,
          method: "builtin.fs",
        };
      } catch (error) {
        return {
          error: mapTreeError(error),
          command,
        };
      }
    },
  });
