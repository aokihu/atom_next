import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, readlink, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { createPermissionPolicy } from "../permissions";
import type { ToolExecutionContext } from "../types";

type LsToolInput = {
  dirpath: string;
  all?: boolean;
  long?: boolean;
};

type LsListEntry = {
  name: string;
  fullPath: string;
};

type LsLongRow = {
  mode: string;
  nlink: string;
  uid: string;
  gid: string;
  size: string;
  mtime: string;
  name: string;
};

/**
 * `ls` 默认按名称稳定排序，保证测试和模型消费都更稳定。
 */
const sortDirEntriesByName = (entries: Dirent[]) =>
  [...entries].sort((a, b) => a.name.localeCompare(b.name));

const pad2 = (value: number) => value.toString().padStart(2, "0");

const formatTimestamp = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

const getFileTypeChar = (stats: Stats) => {
  if (stats.isDirectory()) return "d";
  if (stats.isFile()) return "-";
  if (stats.isSymbolicLink()) return "l";
  return "?";
};

const formatMode = (stats: Stats) => {
  const mode = stats.mode ?? 0;
  const perms = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
  const symbols = ["r", "w", "x", "r", "w", "x", "r", "w", "x"];
  const permissionChars = perms.map((bit, index) => (mode & bit ? symbols[index] : "-"));
  return `${getFileTypeChar(stats)}${permissionChars.join("")}`;
};

const toNumberField = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "-";

const toOutputText = (lines: string[]) => (lines.length === 0 ? "" : `${lines.join("\n")}\n`);

const isErrnoError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

/**
 * 统一映射目录读取错误。
 */
const mapDirectoryError = (error: unknown) => {
  if (isErrnoError(error)) {
    if (error.code === "ENOENT") return "Directory path does not exist";
    if (error.code === "ENOTDIR") return "Path is not a directory";
    if (error.code === "EACCES" || error.code === "EPERM") {
      return "Permission denied: unable to read directory";
    }
  }

  return error instanceof Error ? error.message : "ls operation failed";
};

/**
 * 构造可见目录项。
 * @description
 * v1 不引入额外隐藏规则，只处理 `all` 参数和稳定排序。
 */
const buildVisibleEntries = async (dirpath: string, all: boolean) => {
  let entries = await readdir(dirpath, { withFileTypes: true });

  if (!all) {
    entries = entries.filter((entry) => !entry.name.startsWith("."));
  }

  entries = sortDirEntriesByName(entries);

  const result: LsListEntry[] = entries.map((entry) => ({
    name: entry.name,
    fullPath: join(dirpath, entry.name),
  }));

  if (all) {
    result.unshift({ name: ".", fullPath: dirpath }, { name: "..", fullPath: dirname(dirpath) });
  }

  return result;
};

/**
 * `ls -l` 风格显示名。
 * @description
 * 对 symlink 显示 `name -> target`，提高输出可读性。
 */
const getLongDisplayName = async (name: string, fullPath: string, stats: Stats) => {
  if (!stats.isSymbolicLink()) {
    return name;
  }

  try {
    const target = await readlink(fullPath);
    return `${name} -> ${target}`;
  } catch {
    return `${name} -> [unreadable]`;
  }
};

/**
 * 生成长列表输出行。
 */
const buildLongRows = async (entries: LsListEntry[]) => {
  const rows = await Promise.all(
    entries.map(async ({ name, fullPath }): Promise<LsLongRow> => {
      const entryStat = await lstat(fullPath);

      return {
        mode: formatMode(entryStat),
        nlink: toNumberField(entryStat.nlink),
        uid: toNumberField((entryStat as { uid?: number }).uid),
        gid: toNumberField((entryStat as { gid?: number }).gid),
        size: toNumberField(entryStat.size),
        mtime: formatTimestamp(entryStat.mtime),
        name: await getLongDisplayName(name, fullPath, entryStat),
      };
    }),
  );

  const widths = rows.reduce(
    (acc, row) => ({
      nlink: Math.max(acc.nlink, row.nlink.length),
      uid: Math.max(acc.uid, row.uid.length),
      gid: Math.max(acc.gid, row.gid.length),
      size: Math.max(acc.size, row.size.length),
    }),
    { nlink: 1, uid: 1, gid: 1, size: 1 },
  );

  return rows.map(
    (row) =>
      `${row.mode} ${row.nlink.padStart(widths.nlink, " ")} ${row.uid.padStart(widths.uid, " ")} ${row.gid.padStart(widths.gid, " ")} ${row.size.padStart(widths.size, " ")} ${row.mtime} ${row.name}`,
  );
};

/**
 * 列目录工具。
 * @description
 * 输出统一返回 `command + output + method`，便于后续接显示层。
 */
export const lsTool = (context: ToolExecutionContext) =>
  ({
    description: "List files in a directory using built-in filesystem APIs",
    inputSchema: z.object({
      dirpath: z.string().describe("the absolute path of a directory inside the current workspace"),
      all: z.boolean().optional().describe("list hidden files when true"),
      long: z.boolean().optional().describe("use long listing format when true"),
    }),
    execute: async ({ dirpath, all = false, long = false }: LsToolInput) => {
      const policy = createPermissionPolicy(context);
      const permissionResult = await policy.ensureReadableDirectory(dirpath, "ls");

      if (!permissionResult.ok) {
        return {
          error: permissionResult.error,
        };
      }

      const command = ["ls", all ? "-a" : "", long ? "-l" : "", dirpath].filter(Boolean).join(" ");

      try {
        const dirStat = await stat(dirpath);

        // `ls` 只接受目录，文件路径应交给 read 处理。
        if (!dirStat.isDirectory()) {
          return {
            error: "Path is not a directory",
            command,
          };
        }

        const entries = await buildVisibleEntries(dirpath, all);
        const lines = long ? await buildLongRows(entries) : entries.map((entry) => entry.name);

        return {
          dirpath,
          command,
          output: toOutputText(lines),
          method: "builtin.fs",
        };
      } catch (error) {
        return {
          error: mapDirectoryError(error),
          command,
        };
      }
    },
  });
