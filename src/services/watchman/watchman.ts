import { generateText } from "ai";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isPlainObject, isString } from "radashi";
import { createModelWithProvider } from "@/core/transport/model";
import type { RuntimeService } from "@/services/runtime";
import { BaseService } from "../base";
import {
  AGENTS_FILE,
  COMPILED_PROMPTS_DIR,
  WATCHMAN_COMPILE_TIMEOUT_MS,
  WATCHMAN_COMPILE_SYSTEM_PROMPT,
  WATCHMAN_FILE,
  WATCHMAN_META_VERSION,
} from "./constants";
import type {
  WatchmanWorkerControlMessage,
  WatchmanWorkerEventMessage,
} from "./protocol";
import { WatchmanWorkerSignal } from "./protocol";
import type { WatchmanMeta, WatchmanMetaEntry, WatchmanStatus } from "./types";
import { WatchmanPhase } from "./types";

type WatchmanWorkerPort = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent<WatchmanWorkerEventMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

type WatchmanServiceOptions = {
  compilePrompt?: (content: string, abortSignal?: AbortSignal) => Promise<string>;
  createWorker?: () => WatchmanWorkerPort;
};

/**
 * Watchman 服务
 * @description
 * 这个服务负责把 workspace 根目录下的 `AGENTS.md` 维护成一份
 * 可以安全拼接进系统提示词的编译结果，并持续暴露给 Runtime 使用。
 *
 * 职责边界分为三层：
 * 1. 监听 `AGENTS.md` 是否发生变化。
 * 2. 按 hash 读取或写入编译缓存，避免重复请求 LLM。
 * 3. 向 Runtime 暴露当前状态和最新的编译结果。
 *
 * 这里不会直接参与对话请求，也不会接管 Runtime 的提示词拼接逻辑，
 * 它只提供“编译后的用户提示词”这一份可消费结果。
 * @author aokihu <aokihu@gmail.com>
 * @version 1.0
 */

export class WatchmanService extends BaseService {
  /* ===================== */
  /*      Properties       */
  /* ===================== */

  #worker: WatchmanWorkerPort | undefined;
  #agentsPrompt: string;
  #status: WatchmanStatus;
  #syncTask: Promise<void>;
  #compilePrompt: (content: string, abortSignal?: AbortSignal) => Promise<string>;
  #createWorker: () => WatchmanWorkerPort;
  #compileAbortController: AbortController | undefined;

  /* ===================== */
  /*      Constructor      */
  /* ===================== */

  constructor(options: WatchmanServiceOptions = {}) {
    super();
    this._name = "watchman";
    this.#worker = undefined;
    this.#agentsPrompt = "";
    this.#status = {
      phase: WatchmanPhase.IDLE,
      hash: null,
      updatedAt: null,
      error: null,
    };
    this.#syncTask = Promise.resolve();
    this.#compileAbortController = undefined;
    this.#compilePrompt =
      options.compilePrompt ??
      ((content, abortSignal) => {
        return this.#compileAgentsPrompt(content, abortSignal);
      });
    this.#createWorker =
      options.createWorker ??
      (() => {
        return new Worker("./src/services/watchman/monitor.worker.ts", {
          type: "module",
        }) as WatchmanWorkerPort;
      });
  }

  /* ===================== */
  /*   Private Methods     */
  /* ===================== */

  /**
   * 获取 Runtime 服务
   * @description
   * watchman 自身不持有 runtime 实例，统一在 service register 之后
   * 再通过 service manager 按需读取，避免构造阶段提前绑定运行时参数。
   */
  #getRuntime() {
    const runtime = this._serviceManager?.getService<RuntimeService>("runtime");

    if (!runtime) {
      throw new Error("Runtime service not found");
    }

    return runtime;
  }

  /**
   * 获取 workspace 目录
   * @description
   * watchman 的全部文件读写都以 workspace 为根，
   * 包括 `AGENTS.md`、`watchman.json` 和 `compiled_prompts`。
   */
  #getWorkspace() {
    return this.#getRuntime().getWorkspace();
  }

  /**
   * 同步用户代理提示词到 RuntimeService
   * @description
   * Runtime(Core) 只允许从 RuntimeService 读取用户提示词和状态，
   * 因此 watchman 每次状态或编译结果变化后，都要把最新快照写回 RuntimeService。
   */
  #syncRuntimeUserAgentState() {
    const runtime = this.#getRuntime();
    runtime.setUserAgentPrompt(this.#agentsPrompt);
    runtime.setUserAgentPromptStatus(this.#status);
  }

  /**
   * 获取 AGENTS 文件路径
   * @description
   * 当前 0.3 范围只处理 workspace 根目录下单个 `AGENTS.md`，
   * 不做递归扫描，也不做多文件合并。
   */
  #getAgentsFilePath() {
    return join(this.#getWorkspace(), AGENTS_FILE);
  }

  /**
   * 获取编译输出目录
   * @description
   * 编译后的安全提示词按 hash 单独落盘，便于命中缓存和问题排查。
   */
  #getCompiledPromptsDir() {
    return join(this.#getWorkspace(), COMPILED_PROMPTS_DIR);
  }

  /**
   * 获取 watchman 元信息文件路径
   * @description
   * `watchman.json` 只保存轻量元数据，不直接保存编译正文，
   * 这样可以把“索引信息”和“大文本内容”拆开维护。
   */
  #getWatchmanFilePath() {
    return join(this.#getWorkspace(), WATCHMAN_FILE);
  }

  /**
   * 解析提示词 hash
   * @description
   * hash 基于原始 `AGENTS.md` 内容生成，用来判断是否能直接复用历史编译结果。
   * 同一份原文始终落到同一个编译文件，缓存路径稳定可预测。
   */
  #parsePromptHash(content: string) {
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * 创建默认的 watchman 元信息
   * @description
   * 当元信息文件不存在、损坏或无法解析时，统一退化到这个最小可用结构，
   * 保证 watchman 可以继续工作，而不是被脏数据卡死。
   */
  #buildDefaultMeta(): WatchmanMeta {
    return {
      version: WATCHMAN_META_VERSION,
      currentHash: null,
      updatedAt: null,
      entries: {},
    };
  }

  /**
   * 解析单条编译缓存元信息
   * @description
   * watchman.json 允许保留历史版本留下来的脏数据，
   * 这里只接收当前版本真正需要的字段，其他内容直接忽略。
   */
  #parseMetaEntry(entry: unknown) {
    if (!isPlainObject(entry)) {
      return undefined;
    }

    const parsedEntry = entry as Record<string, unknown>;

    if (!isString(parsedEntry.compiledFile)) {
      return undefined;
    }

    return typeof parsedEntry.compiledAt === "number"
      ? {
          compiledFile: parsedEntry.compiledFile,
          compiledAt: parsedEntry.compiledAt,
        }
      : undefined;
  }

  /**
   * 解析编译缓存集合
   * @description
   * 这里会过滤掉不符合当前结构约定的条目，只保留可直接使用的缓存记录。
   * 这样旧版本残留字段不会污染当前版本逻辑。
   */
  #parseMetaEntries(entries: unknown): Record<string, WatchmanMetaEntry> {
    if (!isPlainObject(entries)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(entries).flatMap(([hash, entry]) => {
        const parsedEntry = this.#parseMetaEntry(entry);
        return parsedEntry ? [[hash, parsedEntry]] : [];
      }),
    );
  }

  /**
   * 解析 watchman 元信息
   * @description
   * 外部文件内容一律按 `unknown` 处理，先做结构收窄，再映射成内部稳定结构。
   * 这样后续同步逻辑可以只面对干净的 `WatchmanMeta`，不需要重复做字段判空。
   */
  #parseWatchmanMeta(rawMeta: unknown): WatchmanMeta {
    if (!isPlainObject(rawMeta)) {
      return this.#buildDefaultMeta();
    }

    const parsedMeta = rawMeta as Record<string, unknown>;

    return {
      version: WATCHMAN_META_VERSION,
      currentHash: isString(parsedMeta.currentHash) ? parsedMeta.currentHash : null,
      updatedAt:
        typeof parsedMeta.updatedAt === "number" ? parsedMeta.updatedAt : null,
      entries: this.#parseMetaEntries(parsedMeta.entries),
    };
  }

  /**
   * 读取 watchman 元信息
   * @description
   * 元信息读取失败并不是致命错误，最坏情况只是丢失缓存命中能力，
   * 所以这里选择回退到默认结构，而不是直接中断整个服务启动。
   */
  async #readWatchmanMeta() {
    const watchmanFile = Bun.file(this.#getWatchmanFilePath());

    if (!(await watchmanFile.exists())) {
      return this.#buildDefaultMeta();
    }

    try {
      return this.#parseWatchmanMeta(await watchmanFile.json());
    } catch {
      return this.#buildDefaultMeta();
    }
  }

  /**
   * 写入 watchman 元信息
   * @description
   * 每次同步结束后都会刷新 `watchman.json`，让磁盘状态和内存状态尽量保持一致。
   */
  async #writeWatchmanMeta(meta: WatchmanMeta) {
    await Bun.write(
      this.#getWatchmanFilePath(),
      JSON.stringify(meta, null, 2),
    );
  }

  /**
   * 获取编译文件路径
   * @description
   * 编译结果以 `{hash}.md` 形式存放，命中缓存时可以直接按 hash 读取。
   */
  #getCompiledFilePath(hash: string) {
    return join(this.#getCompiledPromptsDir(), `${hash}.md`);
  }

  /**
   * 设置当前状态
   * @description
   * watchman 对外只暴露一份当前状态快照，
   * 所有阶段切换都统一经过这里，保证时间戳和错误信息更新方式一致。
   */
  #setStatus(phase: WatchmanPhase, hash: string | null, error?: string) {
    this.#status = {
      phase,
      hash,
      updatedAt: Date.now(),
      error: error ?? null,
    };
    this.#syncRuntimeUserAgentState();
  }

  /**
   * 设置当前编译后的用户提示词
   * @description
   * 这里统一维护内存提示词，并立即同步到 RuntimeService，
   * 避免 watchman 和 runtime 之间出现不同步的状态。
   */
  #setAgentsPrompt(prompt: string) {
    this.#agentsPrompt = prompt;
    this.#syncRuntimeUserAgentState();
  }

  /**
   * 创建编译器模型
   * @description
   * watchman 的编译模型直接复用 RuntimeService 的 providerProfiles 解析结果。
   * 这样只要用户调整了 `basic` 档位，watchman 就会自动跟随新的 provider/model，
   * 不需要在服务内部重复维护一套模型选择逻辑。
   */
  #createCompilerModel() {
    const runtime = this.#getRuntime();
    const { selectedModel, providerConfig } =
      runtime.getModelProfileConfigWithLevel("basic");

    return createModelWithProvider(
      selectedModel,
      providerConfig,
      "config.providerProfiles.basic",
    );
  }

  /**
   * 编译 Agent 提示词
   * @description
   * 这里走的是 watchman 独立的微型编译流程，不复用对话 Transport。
   * 目标是把原始 `AGENTS.md` 转换成一份可以安全拼接到 system prompt 的纯 Markdown。
   */
  async #compileAgentsPrompt(content: string, abortSignal?: AbortSignal) {
    const model = this.#createCompilerModel();

    const result = await generateText({
      model,
      system: WATCHMAN_COMPILE_SYSTEM_PROMPT,
      prompt: content,
      abortSignal,
    });

    return result.text.trim();
  }

  /**
   * 执行一次可中断的提示词编译
   * @description
   * watchman 停止或重启时，不能无限等待外部 LLM 返回，
   * 这里统一为编译过程挂上 abort signal 和超时控制。
   */
  async #runCompilePrompt(content: string) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(new Error("Watchman compile timed out"));
    }, WATCHMAN_COMPILE_TIMEOUT_MS);

    this.#compileAbortController = abortController;

    try {
      return await this.#compilePrompt(content, abortController.signal);
    } finally {
      clearTimeout(timeout);

      if (this.#compileAbortController === abortController) {
        this.#compileAbortController = undefined;
      }
    }
  }

  /**
   * 同步 AGENTS 提示词
   * @description
   * 这是 watchman 的核心状态机入口，流程固定为：
   * 1. 读取 `watchman.json`
   * 2. 检查 `AGENTS.md` 是否存在或是否为空
   * 3. 计算原文 hash 并尝试命中缓存
   * 4. 未命中时走编译流程
   * 5. 更新磁盘缓存、内存提示词和对外状态
   *
   * `force=true` 时会跳过缓存命中，通常由 `recompile()` 触发。
   */
  async #syncAgentsPrompt(force = false) {
    let promptHash: string | null = null;

    try {
      const meta = await this.#readWatchmanMeta();
      const agentsFile = Bun.file(this.#getAgentsFilePath());

      if (!(await agentsFile.exists())) {
        this.#setAgentsPrompt("");
        meta.currentHash = null;
        meta.updatedAt = Date.now();
        await this.#writeWatchmanMeta(meta);
        this.#setStatus(WatchmanPhase.READY, null);
        return;
      }

      const content = await agentsFile.text();
      promptHash = this.#parsePromptHash(content);

      if (content.trim() === "") {
        this.#setAgentsPrompt("");
        meta.currentHash = promptHash;
        meta.updatedAt = Date.now();
        await this.#writeWatchmanMeta(meta);
        this.#setStatus(WatchmanPhase.READY, promptHash);
        return;
      }

      this.#setStatus(WatchmanPhase.COMPILING, promptHash);

      if (!force) {
        const cacheEntry = meta.entries[promptHash];

        if (
          cacheEntry &&
          (await Bun.file(cacheEntry.compiledFile).exists())
        ) {
          this.#setAgentsPrompt(await Bun.file(cacheEntry.compiledFile).text());
          meta.currentHash = promptHash;
          meta.updatedAt = Date.now();
          await this.#writeWatchmanMeta(meta);
          this.#setStatus(WatchmanPhase.READY, promptHash);
          return;
        }
      }

      const compiledPrompt = await this.#runCompilePrompt(content);
      const compiledFile = this.#getCompiledFilePath(promptHash);
      const compiledAt = Date.now();

      await Bun.write(compiledFile, compiledPrompt);

      meta.entries[promptHash] = {
        compiledFile,
        compiledAt,
      };
      meta.currentHash = promptHash;
      meta.updatedAt = compiledAt;

      await this.#writeWatchmanMeta(meta);

      this.#setAgentsPrompt(compiledPrompt);
      this.#setStatus(WatchmanPhase.READY, promptHash);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown watchman error";

      this.#setStatus(WatchmanPhase.ERROR, promptHash ?? this.#status.hash, message);
      throw error;
    }
  }

  /**
   * 串行执行同步任务
   * @description
   * `start()`、worker 变更事件和手动 `recompile()` 都会触发同步。
   * 这里用一条 promise 链把它们串起来，避免多次并发同步互相覆盖状态、
   * 重复写缓存文件，或者让旧结果反向覆盖新结果。
   */
  #syncSerially(force = false) {
    const task = this.#syncTask
      .catch(() => undefined)
      .then(() => this.#syncAgentsPrompt(force));

    this.#syncTask = task.catch(() => undefined);
    return task;
  }

  /* --- Worker Handlers --- */

  /**
   * 启动 worker 监听
   * @description
   * worker 需要在首次同步前就挂上，
   * 这样初次编译期间如果 AGENTS.md 被改动，也能把变更排队到下一轮同步。
   */
  #startWorker() {
    if (this.#worker) {
      return;
    }

    this.#worker = this.#createWorker();
    this.#worker.onmessage = (event) => {
      this.#handleWorkerMessage(event);
    };
    this.#worker.onerror = (event) => {
      const message =
        event.error instanceof Error
          ? event.error.message
          : event.message || "Watchman worker failed";

      this.#setStatus(WatchmanPhase.ERROR, this.#status.hash, message);
    };
    this.#worker.postMessage({
      type: WatchmanWorkerSignal.START,
      workspace: this.#getWorkspace(),
    } satisfies WatchmanWorkerControlMessage);
  }

  /**
   * 处理 worker 回传事件
   * @description
   * worker 只负责告诉主线程“文件变了”或“监听出错了”。
   * 真正的文件读取、缓存命中和编译仍然全部在主线程完成，
   * 这样可以保证状态管理和磁盘写入只有一个来源。
   */
  #handleWorkerMessage(event: MessageEvent<WatchmanWorkerEventMessage>) {
    const message = event.data;

    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === WatchmanWorkerSignal.CHANGED) {
      this.#syncSerially().catch((error) => {
        console.error(
          "Watchman sync failed: %s",
          error instanceof Error ? error.message : "Unknown watchman error",
        );
      });
      return;
    }

    if (message.type === WatchmanWorkerSignal.ERROR) {
      this.#setStatus(WatchmanPhase.ERROR, this.#status.hash, message.error);
    }
  }

  /* ===================== */
  /*    Public Methods     */
  /* ===================== */

  /**
   * 启动 watchman 服务
   * @description
   * 启动顺序刻意安排为：
   * 1. 先确保缓存目录存在
   * 2. 再挂上 worker 监听
   * 3. 最后执行首次同步
   *
   * 这样即使首次同步比较慢，期间对 `AGENTS.md` 的修改也不会被漏掉。
   */
  override async start() {
    await mkdir(this.#getCompiledPromptsDir(), {
      recursive: true,
    });

    this.#startWorker();
    await this.#syncSerially();
  }

  /**
   * 停止 watchman 服务
   * @description
   * 停止时会先中断正在进行的编译，再关闭 worker，
   * 最后等待当前同步链自然收尾，避免留下半写入状态或悬挂 Promise。
   */
  override async stop() {
    this.#compileAbortController?.abort(new Error("Watchman compile stopped"));

    if (this.#worker) {
      this.#worker.postMessage({
        type: WatchmanWorkerSignal.STOP,
      } satisfies WatchmanWorkerControlMessage);
      this.#worker.terminate();
      this.#worker = undefined;
    }

    await this.#syncTask.catch(() => undefined);
    this.#syncTask = Promise.resolve();
    this.#compileAbortController = undefined;

    this.#agentsPrompt = "";
    this.#status = {
      phase: WatchmanPhase.IDLE,
      hash: null,
      updatedAt: null,
      error: null,
    };
    this.#syncRuntimeUserAgentState();
  }

  /**
   * 重启 watchman 服务
   * @description
   * 重启语义保持简单明确：完整 stop 后再重新 start，
   * 不做中间态复用，避免把旧的 worker 或旧状态残留到下一轮运行里。
   */
  override async restart() {
    await this.stop();
    await this.start();
  }

  /**
   * 强制重新编译当前 AGENTS.md
   * @description
   * 这个入口会跳过 hash 缓存命中逻辑，适合在用户明确要求重编译时调用。
   */
  public async recompile() {
    await this.#syncSerially(true);
  }

  /**
   * 获得 watchman 的当前状态
   * @description
   * 返回的是状态快照副本，而不是内部引用，调用方不能直接篡改服务内部状态。
   */
  public getStatus() {
    return structuredClone(this.#status);
  }

  /**
   * 获取当前可用的编译提示词
   * @description
   * 这里返回的是已经完成安全编译后的文本。
   * 当 `AGENTS.md` 缺失、为空或编译结果尚不可用时，返回空字符串。
   */
  public getAgentsPrompt() {
    return this.#agentsPrompt;
  }

  /**
   * 兼容旧接口名
   * @description
   * 当前真实语义接口是 `getAgentsPrompt()`，这里保留别名只是为了兼容现有调用方。
   */
  public getCompiledTextPrompt() {
    return this.getAgentsPrompt();
  }
}
