// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";
import { WatchmanService, WatchmanWorkerSignal } from "@/services/watchman";

const WATCHMAN_API_KEY = "WATCHMAN_API_KEY";

const tempDirs: string[] = [];
const services: WatchmanService[] = [];

const createWorkspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), "atom-next-watchman-"));
  tempDirs.push(dir);
  return dir;
};

const buildRuntime = (
  workspace: string,
  basicProfile = "openaiCompatible/watchman-basic",
) => {
  const runtime = new RuntimeService();

  runtime.loadCliArgs({
    mode: "both",
    config: join(workspace, "config.json"),
    workspace,
    sandbox: join(workspace, "sandbox"),
    serverUrl: "",
    address: "127.0.0.1",
    port: 8787,
  });

  runtime.loadConfig({
    version: 2,
    providerProfiles: {
      advanced: "deepseek/deepseek-chat",
      balanced: "deepseek/deepseek-chat",
      basic: basicProfile,
    },
    providers: {
      deepseek: {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        models: ["deepseek-chat"],
      },
      openaiCompatible: {
        apiKeyEnv: WATCHMAN_API_KEY,
        baseUrl: "https://example.com/v1",
        models: ["watchman-basic"],
      },
    },
    gateway: {
      enable: false,
      channels: [],
    },
  });

  return runtime;
};

const registerServices = (runtime: RuntimeService, watchman: WatchmanService) => {
  const serviceManager = new ServiceManager();
  serviceManager.register(runtime, watchman);
  return serviceManager;
};

const parsePromptHash = (content: string) => {
  return createHash("sha256").update(content).digest("hex");
};

const waitFor = async (predicate: () => boolean | Promise<boolean>) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 2_000) {
    if (await predicate()) {
      return;
    }

    await Bun.sleep(20);
  }

  throw new Error("waitFor timeout");
};

const createFakeWorker = () => {
  const worker = {
    onmessage: null,
    onerror: null,
    messages: [],
    terminated: false,
    postMessage(message) {
      this.messages.push(message);
    },
    terminate() {
      this.terminated = true;
    },
    emit(message) {
      this.onmessage?.({
        data: message,
      });
    },
  };

  return worker;
};

beforeEach(() => {
  process.env[WATCHMAN_API_KEY] = "watchman-test-key";
});

afterEach(async () => {
  await Promise.all(
    services.splice(0).map(async (service) => {
      await service.stop();
    }),
  );

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("WatchmanService", () => {
  test("returns ready with empty prompt when AGENTS.md is missing", async () => {
    const workspace = await createWorkspace();
    const compilePrompt = mock(async () => "should not run");
    const worker = createFakeWorker();
    const runtime = buildRuntime(workspace);
    const service = new WatchmanService({
      compilePrompt,
      createWorker: () => worker,
    });
    registerServices(runtime, service);

    services.push(service);

    await service.start();

    expect(service.getStatus()).toEqual({
      phase: "ready",
      hash: null,
      updatedAt: expect.any(Number),
      error: null,
    });
    expect(service.getAgentsPrompt()).toBe("");
    expect(runtime.getUserAgentPrompt()).toBe("");
    expect(runtime.getUserAgentPromptStatus()).toEqual({
      phase: "ready",
      hash: null,
      updatedAt: expect.any(Number),
      error: null,
    });
    expect(compilePrompt).not.toHaveBeenCalled();
  });

  test("does not require compiler config when AGENTS.md is missing", async () => {
    const workspace = await createWorkspace();
    const worker = createFakeWorker();
    const runtime = buildRuntime(workspace);
    const service = new WatchmanService({
      createWorker: () => worker,
    });

    delete process.env[WATCHMAN_API_KEY];
    registerServices(runtime, service);
    services.push(service);

    await service.start();

    expect(service.getStatus().phase).toBe("ready");
    expect(service.getAgentsPrompt()).toBe("");
  });

  test("follows runtime basic profile without enforcing openaiCompatible", async () => {
    const workspace = await createWorkspace();
    const compilePrompt = mock(async () => "# safe rules");
    const worker = createFakeWorker();

    await writeFile(join(workspace, "AGENTS.md"), "# rules");

    const runtime = buildRuntime(workspace, "deepseek/deepseek-chat");
    const service = new WatchmanService({
      compilePrompt,
      createWorker: () => worker,
    });
    registerServices(runtime, service);
    services.push(service);

    await service.start();

    expect(service.getStatus().phase).toBe("ready");
    expect(service.getAgentsPrompt()).toBe("# safe rules");
    expect(runtime.getUserAgentPrompt()).toBe("# safe rules");
    expect(runtime.getUserAgentPromptStatus().phase).toBe("ready");
    expect(compilePrompt).toHaveBeenCalledTimes(1);
  });

  test("loads cached compiled prompt without recompiling", async () => {
    const workspace = await createWorkspace();
    const agentsContent = "# user rules";
    const promptHash = parsePromptHash(agentsContent);
    const compiledPrompt = "# safe rules";
    const compilePrompt = mock(async () => "should not run");
    const worker = createFakeWorker();

    await writeFile(join(workspace, "AGENTS.md"), agentsContent);
    await mkdir(join(workspace, "compiled_prompts"), { recursive: true });
    await writeFile(
      join(workspace, "compiled_prompts", `${promptHash}.md`),
      compiledPrompt,
    );
    await writeFile(
      join(workspace, "watchman.json"),
      JSON.stringify({
        version: 1,
        currentHash: promptHash,
        updatedAt: 123,
        entries: {
          [promptHash]: {
            compiledFile: join(workspace, "compiled_prompts", `${promptHash}.md`),
            compiledAt: 123,
          },
        },
      }),
    );

    const runtime = buildRuntime(workspace);
    const service = new WatchmanService({
      compilePrompt,
      createWorker: () => worker,
    });
    registerServices(runtime, service);

    services.push(service);

    await service.start();

    expect(service.getStatus().phase).toBe("ready");
    expect(service.getStatus().hash).toBe(promptHash);
    expect(service.getAgentsPrompt()).toBe(compiledPrompt);
    expect(compilePrompt).not.toHaveBeenCalled();
  });

  test("compiles AGENTS.md and writes watchman cache files", async () => {
    const workspace = await createWorkspace();
    const agentsContent = "# coding style";
    const compiledPrompt = "# safe coding style";
    const promptHash = parsePromptHash(agentsContent);
    const compilePrompt = mock(async () => compiledPrompt);
    const worker = createFakeWorker();

    await writeFile(join(workspace, "AGENTS.md"), agentsContent);

    const runtime = buildRuntime(workspace);
    const service = new WatchmanService({
      compilePrompt,
      createWorker: () => worker,
    });
    registerServices(runtime, service);

    services.push(service);

    await service.start();

    const watchmanMeta = await Bun.file(join(workspace, "watchman.json")).json();
    const compiledFile = join(workspace, "compiled_prompts", `${promptHash}.md`);

    expect(compilePrompt).toHaveBeenCalledTimes(1);
    expect(service.getAgentsPrompt()).toBe(compiledPrompt);
    expect(runtime.getUserAgentPrompt()).toBe(compiledPrompt);
    expect(runtime.getUserAgentPromptStatus().phase).toBe("ready");
    expect(await Bun.file(compiledFile).text()).toBe(compiledPrompt);
    expect(watchmanMeta.currentHash).toBe(promptHash);
    expect(watchmanMeta.entries[promptHash].compiledFile).toBe(compiledFile);
  });

  test("recompile bypasses cache and refreshes compiled prompt", async () => {
    const workspace = await createWorkspace();
    const agentsContent = "# team rules";
    const promptHash = parsePromptHash(agentsContent);
    const compilePrompt = mock()
      .mockResolvedValueOnce("# safe rules v1")
      .mockResolvedValueOnce("# safe rules v2");
    const worker = createFakeWorker();

    await writeFile(join(workspace, "AGENTS.md"), agentsContent);

    const runtime = buildRuntime(workspace);
    const service = new WatchmanService({
      compilePrompt,
      createWorker: () => worker,
    });
    registerServices(runtime, service);

    services.push(service);

    await service.start();
    await service.recompile();

    expect(compilePrompt).toHaveBeenCalledTimes(2);
    expect(service.getStatus().hash).toBe(promptHash);
    expect(service.getAgentsPrompt()).toBe("# safe rules v2");
    expect(
      await Bun.file(
        join(workspace, "compiled_prompts", `${promptHash}.md`),
      ).text(),
    ).toBe("# safe rules v2");
  });

  test("recompiles after worker changed event and returns to ready", async () => {
    const workspace = await createWorkspace();
    const worker = createFakeWorker();
    let resolveCompile;
    const compilePrompt = mock((content: string) => {
      if (content.includes("v2")) {
        return new Promise((resolve) => {
          resolveCompile = resolve;
        });
      }

      return Promise.resolve("# safe rules v1");
    });

    await writeFile(join(workspace, "AGENTS.md"), "# rules v1");

    const runtime = buildRuntime(workspace);
    const service = new WatchmanService({
      compilePrompt,
      createWorker: () => worker,
    });
    registerServices(runtime, service);

    services.push(service);

    await service.start();

    await writeFile(join(workspace, "AGENTS.md"), "# rules v2");
    worker.emit({
      type: WatchmanWorkerSignal.CHANGED,
    });

    await waitFor(() => service.getStatus().phase === "compiling");

    resolveCompile("# safe rules v2");

    await waitFor(() => {
      const status = service.getStatus();
      return status.phase === "ready" && service.getAgentsPrompt() === "# safe rules v2";
    });

    expect(compilePrompt).toHaveBeenCalledTimes(2);
  });

  test("captures AGENTS.md changes during initial sync", async () => {
    const workspace = await createWorkspace();
    const worker = createFakeWorker();
    let resolveCompile;
    const compilePrompt = mock((content: string) => {
      if (content.includes("v1")) {
        return new Promise((resolve) => {
          resolveCompile = resolve;
        });
      }

      return Promise.resolve("# safe rules v2");
    });

    await writeFile(join(workspace, "AGENTS.md"), "# rules v1");

    const runtime = buildRuntime(workspace);
    const service = new WatchmanService({
      compilePrompt,
      createWorker: () => worker,
    });
    registerServices(runtime, service);
    services.push(service);

    const startTask = service.start();

    await waitFor(() => service.getStatus().phase === "compiling");
    await writeFile(join(workspace, "AGENTS.md"), "# rules v2");
    worker.emit({
      type: WatchmanWorkerSignal.CHANGED,
    });

    resolveCompile("# safe rules v1");

    await startTask;
    await waitFor(() => {
      const status = service.getStatus();
      return status.phase === "ready" && service.getAgentsPrompt() === "# safe rules v2";
    });

    expect(compilePrompt).toHaveBeenCalledTimes(2);
  });

  test("keeps runtime ready snapshot when hot reload compile exhausts retries", async () => {
    const workspace = await createWorkspace();
    const worker = createFakeWorker();
    const compilePrompt = mock()
      .mockResolvedValueOnce("# safe rules v1")
      .mockRejectedValue(new Error("compile failed"));

    await writeFile(join(workspace, "AGENTS.md"), "# rules v1");

    const runtime = buildRuntime(workspace);
    const service = new WatchmanService({
      compilePrompt,
      createWorker: () => worker,
      maxCompileRetries: 1,
    });
    registerServices(runtime, service);
    services.push(service);

    await service.start();

    await writeFile(join(workspace, "AGENTS.md"), "# rules v2");
    worker.emit({
      type: WatchmanWorkerSignal.CHANGED,
    });

    await waitFor(() => service.getStatus().phase === "error");

    expect(service.getAgentsPrompt()).toBe("# safe rules v1");
    expect(runtime.getUserAgentPrompt()).toBe("# safe rules v1");
    expect(runtime.getUserAgentPromptStatus()).toEqual({
      phase: "ready",
      hash: parsePromptHash("# rules v1"),
      updatedAt: expect.any(Number),
      error: null,
    });
    expect(service.getStatus()).toEqual({
      phase: "error",
      hash: parsePromptHash("# rules v2"),
      updatedAt: expect.any(Number),
      error: "compile failed",
    });
    expect(compilePrompt).toHaveBeenCalledTimes(3);
  });

  test("aborts in-flight compile when stopping service", async () => {
    const workspace = await createWorkspace();
    const worker = createFakeWorker();
    const compilePrompt = mock((_: string, abortSignal?: AbortSignal) => {
      return new Promise((_, reject) => {
        abortSignal?.addEventListener("abort", () => {
          reject(
            abortSignal.reason instanceof Error
              ? abortSignal.reason
              : new Error("compile aborted"),
          );
        });
      });
    });

    await writeFile(join(workspace, "AGENTS.md"), "# rules v1");

    const runtime = buildRuntime(workspace);
    const service = new WatchmanService({
      compilePrompt,
      createWorker: () => worker,
    });
    registerServices(runtime, service);
    services.push(service);

    const startTask = service.start().catch((error) => error);

    await waitFor(() => service.getStatus().phase === "compiling");
    await service.stop();

    expect(await startTask).toBeInstanceOf(Error);
    expect(service.getStatus()).toEqual({
      phase: "idle",
      hash: null,
      updatedAt: null,
      error: null,
    });
  });

  test("enters error state when basic profile is invalid for transport model creation", async () => {
    const workspace = await createWorkspace();
    const worker = createFakeWorker();

    await writeFile(join(workspace, "AGENTS.md"), "# rules");

    const runtime = buildRuntime(workspace, "custom/model-x");
    const service = new WatchmanService({
      createWorker: () => worker,
    });
    registerServices(runtime, service);
    services.push(service);

    await expect(service.start()).rejects.toThrow(
      "Invalid transport model config: config.providerProfiles.basic contains unsupported provider (custom)",
    );

    expect(service.getStatus()).toEqual({
      phase: "error",
      hash: expect.any(String),
      updatedAt: expect.any(Number),
      error:
        "Invalid transport model config: config.providerProfiles.basic contains unsupported provider (custom)",
    });
    expect(runtime.getUserAgentPrompt()).toBe("");
    expect(runtime.getUserAgentPromptStatus()).toEqual({
      phase: "error",
      hash: expect.any(String),
      updatedAt: expect.any(Number),
      error:
        "Invalid transport model config: config.providerProfiles.basic contains unsupported provider (custom)",
    });
  });
});
