import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnvFiles, setProcessEnv } from "@/bootstrap/env";

const RUN_TIMEOUT_MS = 30_000;
const TUI_INPUT_TEXT = "Milestone 0.5 TUI check";

const stripAnsi = (text: string) => {
  return text
    .replace(/\u001B\][^\u0007]*\u0007/g, "")
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u0008/g, "")
    .replace(/\r/g, "\n");
};

const runTuiTranscript = async () => {
  const projectRoot = resolve(import.meta.dir, "..", "..");
  const playgroundRoot = resolve(projectRoot, "Playground");
  const transcriptDir = mkdtempSync(join(tmpdir(), "atom-next-tui-"));
  const transcriptPath = join(transcriptDir, "tui.log");

  setProcessEnv(parseEnvFiles(playgroundRoot));

  const child = Bun.spawn({
    cmd: [
      "script",
      "-q",
      transcriptPath,
      "sh",
      "-lc",
      `bun src/main.ts --mode both --workspace '${playgroundRoot}' & app=$!; (sleep 2; printf '${TUI_INPUT_TEXT}\\n' > /dev/tty; sleep 4; kill -TERM $app) & wait $app`,
    ],
    cwd: projectRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const result = await Promise.race([
      child.exited.then((code) => ({ code, timeout: false })),
      new Promise<{ code: number; timeout: boolean }>((resolveTimeout) => {
        setTimeout(() => {
          resolveTimeout({ code: -1, timeout: true });
        }, RUN_TIMEOUT_MS);
      }),
    ]);

    if (result.timeout) {
      child.kill();
      throw new Error("TUI transcript run timed out");
    }

    const stdoutText = child.stdout
      ? await new Response(child.stdout).text()
      : "";
    const stderrText = child.stderr
      ? await new Response(child.stderr).text()
      : "";
    const rawTranscript = readFileSync(transcriptPath, "utf8");
    const transcript = stripAnsi(rawTranscript);

    return {
      code: result.code,
      stdoutText,
      stderrText,
      rawTranscript,
      transcript,
      transcriptDir,
    };
  } catch (error) {
    child.kill();
    throw error;
  }
};

let transcriptDir = "";

afterAll(() => {
  if (transcriptDir !== "") {
    rmSync(transcriptDir, { recursive: true, force: true });
  }
});

describe("Milestone 0.5 TUI path", () => {
  test(
    "boots TUI in both mode and renders the core panels",
    async () => {
      const result = await runTuiTranscript();
      transcriptDir = result.transcriptDir;

      expect(result.code).toBe(0);
      expect(result.transcript).toContain("API server started at http://127.0.0.1:");
      expect(result.rawTranscript).toContain("Conversation");
      expect(result.rawTranscript).toContain("Input");
      expect(result.transcript).toContain("session ready:");
      expect(result.transcript).toContain(TUI_INPUT_TEXT);
    },
    RUN_TIMEOUT_MS + 5_000,
  );
});
