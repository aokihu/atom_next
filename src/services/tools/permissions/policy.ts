import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ToolExecutionContext } from "../types";

const isErrnoError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

/**
 * Tools 权限策略。
 * @description
 * v1 固定为“workspace 内、绝对路径、只读”。
 * 这里只处理路径边界和文件/目录类型，不承担更高层审批策略。
 */
export class PermissionPolicy {
  readonly #context: ToolExecutionContext;
  #workspaceResolvedPromise: Promise<string> | null;
  #workspaceRealPromise: Promise<string> | null;

  constructor(context: ToolExecutionContext) {
    this.#context = context;
    this.#workspaceResolvedPromise = null;
    this.#workspaceRealPromise = null;
  }

  /**
   * 读取原始 workspace 配置并做基础格式校验。
   */
  #getWorkspacePath() {
    const workspace = this.#context.workspace.trim();

    if (workspace === "") {
      throw new Error("Tool execution workspace is required");
    }

    if (!isAbsolute(workspace)) {
      throw new Error("Tool execution workspace must be an absolute path");
    }

    return workspace;
  }

  /**
   * 同时缓存 workspace 的 resolve 路径和 realpath。
   * @description
   * macOS 上 `/var` 与 `/private/var` 可能映射到同一目录。
   * 两个版本都保留，可以避免“工作区内缺失路径”
   * 被错误判断成越界路径。
   */
  async #resolveWorkspaceRoot() {
    if (!this.#workspaceResolvedPromise) {
      this.#workspaceResolvedPromise = Promise.resolve(resolve(this.#getWorkspacePath()));
    }

    if (!this.#workspaceRealPromise) {
      this.#workspaceRealPromise = (async () => {
        const workspace = this.#getWorkspacePath();

        try {
          return await realpath(workspace);
        } catch (error) {
          if (isErrnoError(error) && error.code === "ENOENT") {
            throw new Error(`Tool execution workspace does not exist: ${workspace}`);
          }

          throw error;
        }
      })();
    }

    return await Promise.all([
      this.#workspaceResolvedPromise,
      this.#workspaceRealPromise,
    ]);
  }

  /**
   * 解析目标路径用于比较。
   * @description
   * 已存在路径优先使用 realpath，防止 symlink 逃逸；
   * 不存在路径退回 resolve，这样后续工具层还能返回更准确的 not found。
   */
  async #resolveComparablePath(targetPath: string) {
    try {
      return await realpath(targetPath);
    } catch (error) {
      if (isErrnoError(error) && error.code === "ENOENT") {
        return resolve(targetPath);
      }

      throw error;
    }
  }

  /**
   * 判断目标路径是否位于 workspace 内。
   */
  async #isPathWithinWorkspace(targetPath: string) {
    if (!isAbsolute(targetPath)) {
      return false;
    }

    const [workspaceRoots, comparablePath] = await Promise.all([
      this.#resolveWorkspaceRoot(),
      this.#resolveComparablePath(targetPath),
    ]);

    return workspaceRoots.some((workspaceRoot) => {
      const pathRelative = relative(workspaceRoot, comparablePath);

      return pathRelative === ""
        || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
    });
  }

  /**
   * 读文件权限判断。
   * @description
   * 已存在路径必须是 file，不存在路径只判断边界，
   * 具体缺失错误交给工具实现层返回。
   */
  async canReadFile(filepath: string) {
    if (!(await this.#isPathWithinWorkspace(filepath))) {
      return false;
    }

    try {
      const fileStat = await stat(filepath);
      return fileStat.isFile();
    } catch {
      return true;
    }
  }

  /**
   * 读目录权限判断。
   * @description
   * 已存在路径必须是 directory，不存在路径仍允许通过，
   * 这样工具层可以返回“目录不存在”而不是统一 permission denied。
   */
  async canListDir(dirpath: string) {
    if (!(await this.#isPathWithinWorkspace(dirpath))) {
      return false;
    }

    try {
      const dirStat = await stat(dirpath);
      return dirStat.isDirectory();
    } catch {
      return true;
    }
  }

  async canReadTree(dirpath: string) {
    return await this.canListDir(dirpath);
  }

  async canRipgrep(dirpath: string) {
    return await this.canListDir(dirpath);
  }

  /**
   * 写文件权限判断。
   * @description
   * 已存在路径必须不是目录；不存在路径只校验是否仍位于 workspace 内。
   */
  async canWriteFile(filepath: string) {
    if (!(await this.#isPathWithinWorkspace(filepath))) {
      return false;
    }

    try {
      const fileStat = await stat(filepath);
      return !fileStat.isDirectory();
    } catch {
      return true;
    }
  }

  async canCopyFrom(filepath: string) {
    return await this.#isPathWithinWorkspace(filepath);
  }

  async canCopyTo(filepath: string) {
    return await this.#isPathWithinWorkspace(filepath);
  }

  async canMoveFrom(filepath: string) {
    return await this.#isPathWithinWorkspace(filepath);
  }

  async canMoveTo(filepath: string) {
    return await this.#isPathWithinWorkspace(filepath);
  }

  async canUseGit(dirpath: string) {
    return await this.canListDir(dirpath);
  }

  async canUseBash(dirpath: string) {
    return await this.canListDir(dirpath);
  }

  /**
   * 检查命令文本里是否显式引用了 workspace 外路径。
   * @description
   * 这里只做轻量路径扫描：
   * - 绝对路径 `/...`
   * - 相对路径 `./...` `../...`
   * - `~/...`
   *
   * 不尝试完整解析 shell 语法，只负责兜底阻断明显越界引用。
   */
  async hasSensitivePathReference(input: string, cwd?: string) {
    const tokenPattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    const tokens: string[] = [];

    for (const match of input.matchAll(tokenPattern)) {
      const token = match[1] ?? match[2] ?? match[3];

      if (typeof token === "string" && token !== "") {
        tokens.push(token);
      }
    }

    const baseDir = cwd ?? this.#getWorkspacePath();

    for (const rawToken of tokens) {
      const token = rawToken.replace(/^[=:(]+|[;:),]+$/g, "");

      if (token === "" || token.startsWith("-")) {
        continue;
      }

      if (token.startsWith("~/")) {
        return true;
      }

      if (token.startsWith("/")) {
        if (!(await this.#isPathWithinWorkspace(token))) {
          return true;
        }
        continue;
      }

      if (token.startsWith("./") || token.startsWith("../")) {
        if (!(await this.#isPathWithinWorkspace(resolve(baseDir, token)))) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 统一生成 read 工具的前置权限结果。
   */
  async ensureReadableFile(filepath: string) {
    if (!(await this.canReadFile(filepath))) {
      return {
        ok: false,
        error: "Permission denied: read path not allowed",
      } as const;
    }

    return {
      ok: true,
    } as const;
  }

  /**
   * 统一生成目录类工具的前置权限结果。
   */
  async ensureReadableDirectory(dirpath: string, action: "ls" | "tree" | "ripgrep") {
    const allowed = action === "ls"
      ? await this.canListDir(dirpath)
      : action === "tree"
        ? await this.canReadTree(dirpath)
        : await this.canRipgrep(dirpath);

    if (!allowed) {
      return {
        ok: false,
        error: `Permission denied: ${action} path not allowed`,
      } as const;
    }

    return {
      ok: true,
    } as const;
  }

  async ensureWritableFile(filepath: string) {
    if (!(await this.canWriteFile(filepath))) {
      return {
        ok: false,
        error: "Permission denied: write path not allowed",
      } as const;
    }

    return {
      ok: true,
    } as const;
  }

  async ensureCopyPaths(source: string, destination: string) {
    if (!(await this.canCopyFrom(source)) || !(await this.canCopyTo(destination))) {
      return {
        ok: false,
        error: "Permission denied: cp path not allowed",
      } as const;
    }

    return {
      ok: true,
    } as const;
  }

  async ensureMovePaths(source: string, destination: string) {
    if (!(await this.canMoveFrom(source)) || !(await this.canMoveTo(destination))) {
      return {
        ok: false,
        error: "Permission denied: mv path not allowed",
      } as const;
    }

    return {
      ok: true,
    } as const;
  }

  async ensureGitDirectory(dirpath: string) {
    if (!(await this.canUseGit(dirpath))) {
      return {
        ok: false,
        error: "Permission denied: git path not allowed",
      } as const;
    }

    return {
      ok: true,
    } as const;
  }

  async ensureBashDirectory(dirpath: string) {
    if (!(await this.canUseBash(dirpath))) {
      return {
        ok: false,
        error: "Permission denied: bash path not allowed",
      } as const;
    }

    return {
      ok: true,
    } as const;
  }
}

export const createPermissionPolicy = (context: ToolExecutionContext) =>
  new PermissionPolicy(context);
