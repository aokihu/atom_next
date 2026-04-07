import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  AGENTS_FILE,
  MISSING_FILE_FINGERPRINT,
  WATCH_DEBOUNCE_MS,
  WATCH_POLL_INTERVAL_MS,
} from "./constants";
import type {
  WatchmanWorkerControlMessage,
  WatchmanWorkerEventMessage,
} from "./protocol";
import { WatchmanWorkerSignal } from "./protocol";

/**
 * Watchman 文件监听 Worker
 * @description
 * 这个 Worker 只负责检测 `AGENTS.md` 是否发生变化，
 * 不负责读取文件内容，也不负责编译提示词。
 *
 * 监听策略分两层：
 * 1. 在 macOS / Linux 上优先使用 Node.js 内置 `fs.watch` 获取实时事件。
 * 2. 同时使用定时轮询读取文件指纹作为保底，避免原生 watch 漏事件。
 *
 * Worker 和主线程之间的协议很简单：
 * - 主线程发送 `start` / `stop`
 * - Worker 回传 `changed` / `error`
 */
let watcher: FSWatcher | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let lastFingerprint = MISSING_FILE_FINGERPRINT;
let isPolling = false;

/**
 * 向主线程派发 Worker 事件
 */
const postWorkerMessage = (message: WatchmanWorkerEventMessage) => {
  globalThis.postMessage(message);
};

/**
 * 清理变更事件的防抖计时器
 */
const clearDebounceTimer = () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
};

/**
 * 清理轮询计时器
 */
const clearPollTimer = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
};

/**
 * 清理原生 watch 监听器
 */
const clearNativeWatcher = () => {
  if (watcher) {
    watcher.close();
    watcher = undefined;
  }
};

/**
 * 停止当前所有监听手段
 * @description
 * Worker 可能同时持有原生 watch 和轮询定时器，
 * 停止时需要一起清理，避免重复派发 changed 事件。
 */
const stopWatcher = () => {
  clearDebounceTimer();
  clearPollTimer();
  clearNativeWatcher();
};

/**
 * 统一派发 changed 事件
 * @description
 * 文件保存时通常会触发多次底层事件，
 * 这里做一次短防抖，避免主线程重复编译。
 */
const scheduleChangedEvent = () => {
  clearDebounceTimer();
  debounceTimer = setTimeout(() => {
    postWorkerMessage({
      type: WatchmanWorkerSignal.CHANGED,
    });
  }, WATCH_DEBOUNCE_MS);
};

/**
 * 判断当前平台是否启用原生 watch
 * @description
 * 这里优先照顾 macOS / Linux，尽量使用内置 watch 获取低延迟事件。
 * 即使启用了原生 watch，轮询仍然会作为兜底手段保留。
 */
const shouldUseNativeWatch = () => {
  return process.platform === "darwin" || process.platform === "linux";
};

/**
 * 读取 AGENTS.md 的当前文件指纹
 * @description
 * 指纹由 `size + mtimeMs` 组成，足够作为轮询场景下的轻量变更判断依据。
 * 当文件不存在时，返回一个固定的缺失标记。
 */
const parseAgentsFingerprint = async (workspace: string) => {
  try {
    const fileStat = await stat(join(resolve(workspace), AGENTS_FILE));
    return `${fileStat.size}:${fileStat.mtimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return MISSING_FILE_FINGERPRINT;
    }

    throw error;
  }
};

/**
 * 启动轮询监听
 * @description
 * 轮询不是主监听手段，而是为了弥补 `fs.watch` 在不同平台、
 * 不同编辑器保存策略下可能漏事件的问题。
 */
const startPolling = async (workspace: string) => {
  lastFingerprint = await parseAgentsFingerprint(workspace);
  clearPollTimer();

  pollTimer = setInterval(async () => {
    if (isPolling) {
      return;
    }

    isPolling = true;

    try {
      const nextFingerprint = await parseAgentsFingerprint(workspace);

      if (nextFingerprint !== lastFingerprint) {
        lastFingerprint = nextFingerprint;
        scheduleChangedEvent();
      }
    } catch (error) {
      postWorkerMessage({
        type: WatchmanWorkerSignal.ERROR,
        error: error instanceof Error ? error.message : "Watchman poll failed",
      });
    } finally {
      isPolling = false;
    }
  }, WATCH_POLL_INTERVAL_MS);
};

/**
 * 启动原生文件监听
 * @description
 * 这里监听 workspace 根目录，只关心其中的 `AGENTS.md`，
 * 这样即使文件一开始不存在，也能收到后续创建事件。
 */
const startWatcher = (workspace: string) => {
  clearNativeWatcher();

  if (shouldUseNativeWatch()) {
    watcher = watch(resolve(workspace), (eventType, filename) => {
      if (!filename || String(filename) !== AGENTS_FILE) {
        return;
      }

      if (eventType === "rename" || eventType === "change") {
        scheduleChangedEvent();
      }
    });

    watcher.on("error", (error) => {
      postWorkerMessage({
        type: WatchmanWorkerSignal.ERROR,
        error: error.message,
      });
    });
  }
};

/**
 * 处理主线程消息
 * @description
 * `WatchmanWorkerSignal.START` 会先挂原生 watch，再启动轮询兜底；
 * `WatchmanWorkerSignal.STOP` 会清理全部监听资源。
 */
globalThis.addEventListener(
  "message",
  (event: MessageEvent<WatchmanWorkerControlMessage>) => {
    const message = event.data;

    if (message.type === WatchmanWorkerSignal.START) {
      try {
        startWatcher(message.workspace);
      } catch (error) {
        stopWatcher();
        postWorkerMessage({
          type: WatchmanWorkerSignal.ERROR,
          error:
            error instanceof Error ? error.message : "Watchman worker error",
        });
        return;
      }

      startPolling(message.workspace)
        .catch((error) => {
          stopWatcher();
          postWorkerMessage({
            type: WatchmanWorkerSignal.ERROR,
            error:
              error instanceof Error ? error.message : "Watchman worker error",
          });
        });
      return;
    }

    if (message.type === WatchmanWorkerSignal.STOP) {
      try {
        stopWatcher();
      } catch (error) {
        postWorkerMessage({
          type: WatchmanWorkerSignal.ERROR,
          error:
            error instanceof Error ? error.message : "Watchman worker error",
        });
      }
    }
  },
);
