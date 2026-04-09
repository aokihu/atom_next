import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { isString, sleep } from "radashi";
import { parseEnvFiles, setProcessEnv } from "@/bootstrap/env";

const SERVER_BOOT_TIMEOUT_MS = 30_000;
const SERVER_START_PREFIX = "API server started at ";
const DEFAULT_USER_INPUT = "Milestone 0.4 API session path check";

type ServerContext = {
  baseUrl: string;
  child: Bun.Subprocess<"inherit", "pipe", "pipe">;
  stdoutText: Promise<string>;
  stderrText: Promise<string>;
};

type CreateSessionResult = {
  sessionId: string;
};

type SubmitChatResult = {
  chatId: string;
};

type PollChatResult = {
  sessionId: string;
  sessionStatus: number;
  chatId: string;
  chatStatus: "waiting" | "pending" | "processing" | "complete" | "failed";
  createdAt: number;
  updatedAt: number;
};

const parseJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return JSON.parse(text) as T;
};

const waitForServerBaseUrl = async (
  stdout: ReadableStream<Uint8Array>,
  exited: Promise<number>,
) => {
  const reader = stdout.getReader();
  const startAt = Date.now();
  const textDecoder = new TextDecoder();
  let buffer = "";

  try {
    while (Date.now() - startAt < SERVER_BOOT_TIMEOUT_MS) {
      const result = await Promise.race([
        reader.read().then((chunk) => ({ type: "stdout" as const, chunk })),
        exited.then((code) => ({ type: "exit" as const, code })),
        sleep(250).then(() => ({ type: "tick" as const })),
      ]);

      if (result.type === "exit") {
        throw new Error(`Atom server exited before ready, exit code: ${result.code}`);
      }

      if (result.type === "tick") {
        continue;
      }

      if (result.chunk.done) {
        continue;
      }

      buffer += textDecoder.decode(result.chunk.value, {
        stream: true,
      });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith(SERVER_START_PREFIX)) {
          return trimmedLine.slice(SERVER_START_PREFIX.length).trim();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error("Atom server did not report startup URL before timeout");
};

const waitForServerReady = async (
  baseUrl: string,
  exited: Promise<number>,
) => {
  const startAt = Date.now();

  while (Date.now() - startAt < SERVER_BOOT_TIMEOUT_MS) {
    const exitCode = await Promise.race([
      exited.then((code) => code),
      sleep(250).then(() => null),
    ]);

    if (exitCode !== null) {
      throw new Error(`Atom server exited before ready, exit code: ${exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/ping`);
      const text = await response.text();

      if (response.ok && text === "pong") {
        return;
      }
    } catch {}
  }

  throw new Error("Atom server did not become ready before timeout");
};

const startServer = async (): Promise<ServerContext> => {
  const projectRoot = resolve(import.meta.dir, "..", "..");
  const playgroundRoot = resolve(projectRoot, "Playground");
  setProcessEnv(parseEnvFiles(playgroundRoot));

  const child = Bun.spawn({
    cmd: ["bun", "src/main.ts", "--workspace", playgroundRoot],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  });

  if (!child.stdout) {
    throw new Error("Atom server stdout pipe is not available");
  }

  const [stdoutForReady, stdoutForLog] = child.stdout.tee();
  const stdoutText = new Response(stdoutForLog).text();
  const stderrText = child.stderr
    ? new Response(child.stderr).text()
    : Promise.resolve("");

  try {
    // 不向主程序传入任何端口参数，真实地址完全由启动流程自行决定。
    const baseUrl = await waitForServerBaseUrl(stdoutForReady, child.exited);
    await waitForServerReady(baseUrl, child.exited);

    return {
      baseUrl,
      child,
      stdoutText,
      stderrText,
    };
  } catch (error) {
    child.kill();
    await child.exited.catch(() => undefined);

    const [stdout, stderr] = await Promise.all([stdoutText, stderrText]);
    const logs = [stdout.trim(), stderr.trim()].filter((item) => item !== "");
    const suffix =
      logs.length > 0 ? `\n\n${logs.join("\n\n")}` : "";

    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${suffix}`,
    );
  }
};

const stopServer = async (server: ServerContext | undefined) => {
  if (!server) {
    return;
  }

  server.child.kill();
  await server.child.exited.catch(() => undefined);
};

const createSession = async (baseUrl: string) => {
  const result = await parseJson<CreateSessionResult>(
    await fetch(`${baseUrl}/session`, {
      method: "POST",
    }),
  );

  if (!isString(result.sessionId) || result.sessionId.trim() === "") {
    throw new Error("Invalid sessionId returned from POST /session");
  }

  return result;
};

const submitChat = async (baseUrl: string, sessionId: string) => {
  const result = await parseJson<SubmitChatResult>(
    await fetch(`${baseUrl}/session/${sessionId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payload: [
          {
            type: "text",
            data: DEFAULT_USER_INPUT,
          },
        ],
      }),
    }),
  );

  if (!isString(result.chatId) || result.chatId.trim() === "") {
    throw new Error("Invalid chatId returned from POST /session/:sessionId/chat");
  }

  return result;
};

const pollChat = async (baseUrl: string, sessionId: string, chatId: string) => {
  return await parseJson<PollChatResult>(
    await fetch(`${baseUrl}/session/${sessionId}/chat/${chatId}`),
  );
};

describe("Milestone 0.4 API session path", () => {
  let server: ServerContext | undefined;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await stopServer(server);
  });

  test("creates session through POST /session", async () => {
    const result = await createSession(server!.baseUrl);

    expect(isString(result.sessionId)).toBe(true);
    expect(result.sessionId.trim().length > 0).toBe(true);
  });

  test("submits chat through POST /session/:sessionId/chat", async () => {
    const { sessionId } = await createSession(server!.baseUrl);
    const result = await submitChat(server!.baseUrl, sessionId);

    expect(isString(result.chatId)).toBe(true);
    expect(result.chatId.trim().length > 0).toBe(true);
  });

  test("polls chat through GET /session/:sessionId/chat/:chatId", async () => {
    const { sessionId } = await createSession(server!.baseUrl);
    const { chatId } = await submitChat(server!.baseUrl, sessionId);
    const result = await pollChat(server!.baseUrl, sessionId, chatId);

    expect(result.sessionId).toBe(sessionId);
    expect(result.chatId).toBe(chatId);
    expect(
      ["waiting", "pending", "processing", "complete", "failed"].includes(
        result.chatStatus,
      ),
    ).toBe(true);
  });
});
