import { createServer } from "node:net";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseEnvFiles, setProcessEnv } from "@/bootstrap/env";

const SERVER_BOOT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;
const DEFAULT_EXPECTED_TEXT = "ATOM_NEXT_MILESTONE_0_1_OK";
const DEFAULT_USER_INPUT =
  "Return exactly this token and nothing else: ATOM_NEXT_MILESTONE_0_1_OK";

type CreateSessionResult = {
  sessionId: string;
};

type SubmitChatResult = {
  chatId: string;
};

type PollChatResult = {
  sessionId: string;
  chatId: string;
  chatStatus: "waiting" | "pending" | "processing" | "complete" | "failed";
  message?: {
    createdAt: number;
    data: unknown;
  };
  error?: {
    message: string;
    code?: string;
  };
  chunks?: Array<{
    id: string;
    createdAt: number;
    data: unknown;
  }>;
};

const sleep = (ms: number) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const parseJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return JSON.parse(text) as T;
};

const findAvailablePort = async () =>
  await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();

    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPort(new Error("Cannot resolve test port")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }

        resolvePort(port);
      });
    });
  });

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

const normalizeMessageData = (data: unknown) => {
  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return data.join("");
  }

  return JSON.stringify(data);
};

const parseTestParams = () => {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: {
        type: "string",
      },
      expect: {
        type: "string",
      },
    },
  });

  return {
    userInput: parsed.values.input ?? DEFAULT_USER_INPUT,
    expectedText: parsed.values.expect ?? DEFAULT_EXPECTED_TEXT,
  };
};

const main = async () => {
  const projectRoot = resolve(import.meta.dir, "..", "..");
  const playgroundRoot = resolve(projectRoot, "Playground");
  setProcessEnv(parseEnvFiles(playgroundRoot));

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error(
      "Missing environment variable: DEEPSEEK_API_KEY. Set it in Playground/.env before running this script.",
    );
  }

  const { userInput, expectedText } = parseTestParams();
  const port = process.env.MILESTONE_TEST_PORT
    ? Number(process.env.MILESTONE_TEST_PORT)
    : await findAvailablePort();

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid test port: ${port}`);
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const child = Bun.spawn({
    cmd: [
      "bun",
      "src/main.ts",
      "--workspace",
      playgroundRoot,
      "--port",
      String(port),
    ],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutText = child.stdout
    ? new Response(child.stdout).text()
    : Promise.resolve("");
  const stderrText = child.stderr
    ? new Response(child.stderr).text()
    : Promise.resolve("");
  let hasPassed = false;

  try {
    await waitForServerReady(baseUrl, child.exited);

    const { sessionId } = await parseJson<CreateSessionResult>(
      await fetch(`${baseUrl}/session`, {
        method: "POST",
      }),
    );

    const { chatId } = await parseJson<SubmitChatResult>(
      await fetch(`${baseUrl}/session/${sessionId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload: [
            {
              type: "text",
              data: userInput,
            },
          ],
        }),
      }),
    );

    const observedStatuses = new Set<string>();
    const pollStartedAt = Date.now();

    while (Date.now() - pollStartedAt < POLL_TIMEOUT_MS) {
      const result = await parseJson<PollChatResult>(
        await fetch(`${baseUrl}/session/${sessionId}/chat/${chatId}`),
      );

      observedStatuses.add(result.chatStatus);

      if (result.chatStatus === "failed") {
        throw new Error(
          `Chat failed: ${result.error?.message ?? "Unknown chat failure"}`,
        );
      }

      if (result.chatStatus === "complete") {
        const message = normalizeMessageData(result.message?.data);
        const matched = message.includes(expectedText);

        if (!matched) {
          throw new Error(
            `Unexpected final response: ${JSON.stringify(result.message?.data)}`,
          );
        }

        hasPassed = true;
        console.log("Milestone 0.1 real LLM path check passed");
        console.log(`Test input: ${userInput}`);
        console.log(`Expected text: ${expectedText}`);
        console.log(`Matched expected text: ${matched}`);
        console.log(`Server: ${baseUrl}`);
        console.log(`Session: ${sessionId}`);
        console.log(`Chat: ${chatId}`);
        console.log(`Observed statuses: ${[...observedStatuses].join(" -> ")}`);
        console.log(`Final response: ${message}`);
        return;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error("Polling timed out before chat completed");
  } finally {
    child.kill();
    await child.exited.catch(() => undefined);

    const [stdout, stderr] = await Promise.all([stdoutText, stderrText]);
    if (!hasPassed && stdout.trim()) {
      console.log("\n[atom stdout]");
      console.log(stdout.trim());
    }

    if (!hasPassed && stderr.trim()) {
      console.log("\n[atom stderr]");
      console.log(stderr.trim());
    }
  }
};

await main().catch((error) => {
  console.error("Milestone 0.1 real LLM path check failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
