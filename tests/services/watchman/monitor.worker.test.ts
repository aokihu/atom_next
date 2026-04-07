//@ts-nockeck
// @ts-nocheck
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WatchmanWorkerSignal } from "@/services/watchman";

const tempDirs: string[] = [];
const workers: Worker[] = [];

const createWorkspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), "atom-next-monitor-worker-"));
  tempDirs.push(dir);
  return dir;
};

const waitForChanged = async (worker: Worker) => {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("worker did not emit changed event"));
    }, 4000);

    worker.onmessage = (event) => {
      if (event.data?.type === WatchmanWorkerSignal.CHANGED) {
        clearTimeout(timer);
        resolve(event.data);
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timer);
      reject(event.error ?? new Error(event.message));
    };
  });
};

afterEach(async () => {
  workers.splice(0).forEach((worker) => worker.terminate());
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("watchman monitor worker", () => {
  test("emits changed when AGENTS.md is updated", async () => {
    const workspace = await createWorkspace();
    const worker = new Worker(
      new URL("../../../src/services/watchman/monitor.worker.ts", import.meta.url)
        .href,
      {
        type: "module",
      },
    );

    workers.push(worker);

    worker.postMessage({
      type: WatchmanWorkerSignal.START,
      workspace,
    });

    await Bun.sleep(100);
    await writeFile(join(workspace, "AGENTS.md"), "# v1");
    await waitForChanged(worker);
  });
});
