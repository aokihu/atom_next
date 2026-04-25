import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolService } from "@/services";
import {
  resetBashAvailabilityCacheForTest,
  resetGitAvailabilityCacheForTest,
  setBashAvailabilityCacheForTest,
  setGitAvailabilityCacheForTest,
} from "@/services/tools/builtin";

const createWorkspace = async () => {
  const workspace = await mkdtemp(join(tmpdir(), "atom-next-tools-mutate-"));
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "src", "note.txt"), "hello");
  await writeFile(join(workspace, "src", "copy.txt"), "copy me");
  return workspace;
};

describe("mutation and command tools", () => {
  beforeEach(() => {
    resetBashAvailabilityCacheForTest();
    resetGitAvailabilityCacheForTest();
  });

  test("write tool writes and appends file content", async () => {
    const workspace = await createWorkspace();

    try {
      const service = new ToolService();
      const context = service.createExecutionContext({ workspace });
      const registry = service.createToolRegistry({ context });
      const target = join(workspace, "src", "write.txt");

      const firstResult = await registry.write.execute?.({
        filepath: target,
        content: "first",
      });
      const appendResult = await registry.write.execute?.({
        filepath: target,
        content: "\nsecond",
        append: true,
      });

      expect(firstResult).toMatchObject({
        success: true,
        filepath: target,
        append: false,
        method: "builtin.fs",
      });
      expect(appendResult).toMatchObject({
        success: true,
        filepath: target,
        append: true,
        method: "builtin.fs",
      });
      expect(await readFile(target, "utf8")).toBe("first\nsecond");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("write tool rejects out-of-workspace path", async () => {
    const workspace = await createWorkspace();
    const outside = await mkdtemp(join(tmpdir(), "atom-next-tools-outside-"));

    try {
      const service = new ToolService();
      const context = service.createExecutionContext({ workspace });
      const registry = service.createToolRegistry({ context });

      const result = await registry.write.execute?.({
        filepath: join(outside, "x.txt"),
        content: "blocked",
      });

      expect(result).toEqual({
        error: "Permission denied: write path not allowed",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("cp tool copies file and requires recursive for directory", async () => {
    const workspace = await createWorkspace();

    try {
      const service = new ToolService();
      const context = service.createExecutionContext({ workspace });
      const registry = service.createToolRegistry({ context });
      const sourceFile = join(workspace, "src", "copy.txt");
      const destinationFile = join(workspace, "src", "copied.txt");
      const directoryResult = await registry.cp.execute?.({
        source: join(workspace, "src"),
        destination: join(workspace, "src-copy"),
      });
      const fileResult = await registry.cp.execute?.({
        source: sourceFile,
        destination: destinationFile,
      });

      expect(directoryResult).toEqual({
        error: "Source is a directory, set recursive=true to copy directories",
      });
      expect(fileResult).toMatchObject({
        success: true,
        source: sourceFile,
        destination: destinationFile,
        recursive: false,
        overwrite: false,
        method: "builtin.fs",
      });
      expect(await readFile(destinationFile, "utf8")).toBe("copy me");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("mv tool moves file and blocks out-of-workspace destination", async () => {
    const workspace = await createWorkspace();
    const outside = await mkdtemp(join(tmpdir(), "atom-next-tools-outside-"));

    try {
      const service = new ToolService();
      const context = service.createExecutionContext({ workspace });
      const registry = service.createToolRegistry({ context });
      const source = join(workspace, "src", "note.txt");
      const destination = join(workspace, "src", "moved.txt");

      const moveResult = await registry.mv.execute?.({
        source,
        destination,
      });
      const blockedResult = await registry.mv.execute?.({
        source: destination,
        destination: join(outside, "moved.txt"),
      });

      expect(moveResult).toMatchObject({
        success: true,
        source,
        destination,
        overwrite: false,
        method: "builtin.fs",
      });
      expect(await readFile(destination, "utf8")).toBe("hello");
      expect(await Bun.file(source).exists()).toBe(false);
      expect(blockedResult).toEqual({
        error: "Permission denied: mv path not allowed",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("bash tool runs once command in workspace and blocks dangerous command", async () => {
    const workspace = await createWorkspace();

    try {
      const service = new ToolService();
      const context = service.createExecutionContext({ workspace });
      const registry = service.createToolRegistry({ context });

      const successResult = await registry.bash.execute?.({
        command: "pwd",
      });
      const blockedResult = await registry.bash.execute?.({
        command: "rm -rf /",
      });

      expect(successResult).toMatchObject({
        cwd: workspace,
        command: "pwd",
        success: true,
        exitCode: 0,
        method: "builtin.exec",
      });
      expect(String(successResult?.stdout).trim()).toBe(await realpath(workspace));
      expect(blockedResult).toMatchObject({
        error: "Command blocked by builtin safety policy",
        ruleId: "root-rm-rf",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("bash tool returns unavailable error when bash is missing", async () => {
    const workspace = await createWorkspace();

    try {
      setBashAvailabilityCacheForTest(false);

      const service = new ToolService();
      const context = service.createExecutionContext({ workspace });
      const registry = service.createToolRegistry({ context });

      const result = await registry.bash.execute?.({
        command: "echo hello",
      });

      expect(result).toEqual({
        error: "bash command is not available in runtime environment",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("git tool runs status in repo and blocks out-of-workspace cwd", async () => {
    const workspace = await createWorkspace();
    const outside = await mkdtemp(join(tmpdir(), "atom-next-tools-outside-"));

    try {
      await Bun.spawn(["git", "init"], {
        cwd: workspace,
        stdout: "ignore",
        stderr: "ignore",
      }).exited;

      const service = new ToolService();
      const context = service.createExecutionContext({ workspace });
      const registry = service.createToolRegistry({ context });

      const successResult = await registry.git.execute?.({
        cwd: workspace,
        subcommand: "status",
        args: ["--short"],
      });
      const blockedResult = await registry.git.execute?.({
        cwd: outside,
        subcommand: "status",
      });

      expect(successResult).toMatchObject({
        cwd: workspace,
        command: "git status --short",
        success: true,
        exitCode: 0,
        method: "builtin.exec",
      });
      expect(typeof successResult?.stdout).toBe("string");
      expect(blockedResult).toEqual({
        error: "Permission denied: git path not allowed",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("git tool returns unavailable error when git is missing", async () => {
    const workspace = await createWorkspace();

    try {
      setGitAvailabilityCacheForTest(false);

      const service = new ToolService();
      const context = service.createExecutionContext({ workspace });
      const registry = service.createToolRegistry({ context });

      const result = await registry.git.execute?.({
        cwd: workspace,
        subcommand: "status",
      });

      expect(result).toMatchObject({
        error: "git command is not available in runtime environment",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
