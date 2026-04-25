import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolService } from "@/services";

const tempDirs: string[] = [];

const createWorkspace = async () => {
  const workspace = await mkdtemp(join(tmpdir(), "atom-next-tools-"));
  const nestedDir = join(workspace, "src");
  const emptyDir = join(workspace, "empty");

  await mkdir(nestedDir, { recursive: true });
  await mkdir(emptyDir, { recursive: true });
  await writeFile(join(workspace, "README.md"), "# atom_next\nToolService\n");
  await writeFile(join(nestedDir, "index.ts"), "export const answer = 42;\n");
  await writeFile(join(nestedDir, "helper.ts"), "export const helper = 'tool';\n");

  tempDirs.push(workspace);

  return {
    workspace,
    nestedDir,
    emptyDir,
  };
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
  mock.restore();
});

describe("read tool", () => {
  test("reads file content with line numbers", async () => {
    const { workspace } = await createWorkspace();
    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.read.execute?.({
      filepath: join(workspace, "README.md"),
    });

    expect(result).toEqual({
      filepath: join(workspace, "README.md"),
      size: expect.any(Number),
      content: [
        [0, "# atom_next"],
        [1, "ToolService"],
        [2, ""],
      ],
    });
  });

  test("returns missing file error for in-workspace path", async () => {
    const { workspace } = await createWorkspace();
    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.read.execute?.({
      filepath: join(workspace, "missing.md"),
    });

    expect(result).toEqual({
      error: "The file does not exist, check filepath",
    });
  });

  test("rejects out-of-workspace file path", async () => {
    const { workspace } = await createWorkspace();
    const outside = await mkdtemp(join(tmpdir(), "atom-next-tools-outside-"));
    tempDirs.push(outside);
    await writeFile(join(outside, "secret.txt"), "secret");

    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.read.execute?.({
      filepath: join(outside, "secret.txt"),
    });

    expect(result).toEqual({
      error: "Permission denied: read path not allowed",
    });
  });

  test("rejects directory input", async () => {
    const { workspace, nestedDir } = await createWorkspace();
    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.read.execute?.({
      filepath: nestedDir,
    });

    expect(result).toEqual({
      error: "Permission denied: read path not allowed",
    });
  });
});

describe("ls tool", () => {
  test("lists visible files in short format", async () => {
    const { workspace, nestedDir } = await createWorkspace();
    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.ls.execute?.({
      dirpath: nestedDir,
    });

    expect(result).toEqual({
      dirpath: nestedDir,
      command: `ls ${nestedDir}`,
      output: "helper.ts\nindex.ts\n",
      method: "builtin.fs",
    });
  });

  test("supports long listing and hidden files", async () => {
    const { workspace, nestedDir } = await createWorkspace();
    await writeFile(join(nestedDir, ".hidden.ts"), "export const hidden = true;\n");

    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.ls.execute?.({
      dirpath: nestedDir,
      all: true,
      long: true,
    });

    expect(result).toMatchObject({
      dirpath: nestedDir,
      command: `ls -a -l ${nestedDir}`,
      method: "builtin.fs",
    });
    expect(result?.output).toContain(".hidden.ts");
    expect(result?.output).toContain("helper.ts");
    expect(result?.output).toContain("index.ts");
  });

  test("rejects out-of-workspace directory path", async () => {
    const { workspace } = await createWorkspace();
    const outside = await mkdtemp(join(tmpdir(), "atom-next-tools-ls-outside-"));
    tempDirs.push(outside);

    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.ls.execute?.({
      dirpath: outside,
    });

    expect(result).toEqual({
      error: "Permission denied: ls path not allowed",
    });
  });
});

describe("tree tool", () => {
  test("renders directory tree with level limit", async () => {
    const { workspace } = await createWorkspace();
    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.tree.execute?.({
      dirpath: workspace,
      level: 1,
    });

    expect(result).toMatchObject({
      dirpath: workspace,
      command: `tree -L 1 ${workspace}`,
      method: "builtin.fs",
    });
    expect(result?.output).toContain("README.md");
    expect(result?.output).toContain("src/");
  });

  test("supports empty directory", async () => {
    const { workspace, emptyDir } = await createWorkspace();
    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.tree.execute?.({
      dirpath: emptyDir,
    });

    expect(result).toEqual({
      dirpath: emptyDir,
      command: `tree ${emptyDir}`,
      output: `${emptyDir}\n0 directories, 0 files\n`,
      method: "builtin.fs",
    });
  });

  test("rejects out-of-workspace directory path", async () => {
    const { workspace } = await createWorkspace();
    const outside = await mkdtemp(join(tmpdir(), "atom-next-tools-tree-outside-"));
    tempDirs.push(outside);

    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.tree.execute?.({
      dirpath: outside,
    });

    expect(result).toEqual({
      error: "Permission denied: tree path not allowed",
    });
  });
});

describe("ripgrep tool", () => {
  test("returns matches", async () => {
    const { workspace } = await createWorkspace();
    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.ripgrep.execute?.({
      dirpath: workspace,
      pattern: "answer",
    });

    expect(result).toMatchObject({
      dirpath: workspace,
      pattern: "answer",
      command: expect.stringContaining(`rg -i answer ${workspace}`),
    });
    expect(result?.output).toContain("index.ts");
  });

  test("returns empty output when there is no match", async () => {
    const { workspace } = await createWorkspace();
    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.ripgrep.execute?.({
      dirpath: workspace,
      pattern: "definitely-not-found",
    });

    expect(result).toEqual({
      dirpath: workspace,
      pattern: "definitely-not-found",
      command: `rg -i definitely-not-found ${workspace}`,
      output: "",
    });
  });

  test("returns unavailable error when rg command is missing", async () => {
    const { workspace } = await createWorkspace();
    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });
    const originalSpawn = Bun.spawn;

    (Bun as { spawn: typeof Bun.spawn }).spawn = (() => {
      const error = new Error("spawn rg ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }) as typeof Bun.spawn;

    try {
      const result = await registry.ripgrep.execute?.({
        dirpath: workspace,
        pattern: "answer",
      });

      expect(result).toEqual({
        error: "rg command is not available in runtime environment",
        command: `rg -i answer ${workspace}`,
      });
    } finally {
      (Bun as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });

  test("rejects out-of-workspace directory path", async () => {
    const { workspace } = await createWorkspace();
    const outside = await mkdtemp(join(tmpdir(), "atom-next-tools-rg-outside-"));
    tempDirs.push(outside);

    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.ripgrep.execute?.({
      dirpath: outside,
      pattern: "answer",
    });

    expect(result).toEqual({
      error: "Permission denied: ripgrep path not allowed",
    });
  });

  test("rejects symlink escape outside workspace", async () => {
    const { workspace } = await createWorkspace();
    const outside = await mkdtemp(join(tmpdir(), "atom-next-tools-link-outside-"));
    tempDirs.push(outside);
    await writeFile(join(outside, "secret.ts"), "export const secret = true;\n");
    await symlink(outside, join(workspace, "linked-outside"));

    const service = new ToolService();
    const context = service.createExecutionContext({ workspace });
    const registry = service.createToolRegistry({ context });

    const result = await registry.ripgrep.execute?.({
      dirpath: join(workspace, "linked-outside"),
      pattern: "secret",
    });

    expect(result).toEqual({
      error: "Permission denied: ripgrep path not allowed",
    });
  });
});
