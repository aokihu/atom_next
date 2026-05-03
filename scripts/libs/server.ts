import { createServer } from "node:net";

const SERVER_START_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const resolveAvailablePort = async () => {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to resolve available port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
};

export const waitForServerReady = async (
  baseUrl: string,
  serverProcess: ReturnType<typeof Bun.spawn>,
) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    const exitCode = serverProcess.exitCode;

    if (typeof exitCode === "number") {
      throw new Error(`Server exited early with code ${exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/ping`);

      if (response.ok && (await response.text()) === "pong") {
        return;
      }
    } catch {
      // server not ready yet
    }

    await sleep(200);
  }

  throw new Error("Timed out waiting for server to become ready");
};

export const readProcessOutput = async (
  stream: ReadableStream<Uint8Array> | null,
) => {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
};

export const startCoreServer = async (options: {
  repoRoot: string;
  workspaceDir: string;
  port?: number;
  logSilent?: boolean;
}) => {
  const port = options.port ?? (await resolveAvailablePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const args = [
    "bun",
    "run",
    "src/main.ts",
    "--mode",
    "server",
    "--workspace",
    options.workspaceDir,
    "--port",
    String(port),
  ];

  if (options.logSilent ?? true) {
    args.push("--log-silent");
  }

  const serverProcess = Bun.spawn(args, {
    cwd: options.repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  await waitForServerReady(baseUrl, serverProcess);

  return {
    baseUrl,
    port,
    process: serverProcess,
    async stop() {
      serverProcess.kill();
      await serverProcess.exited.catch(() => undefined);
    },
    async readOutputs() {
      const [stdout, stderr] = await Promise.all([
        readProcessOutput(serverProcess.stdout),
        readProcessOutput(serverProcess.stderr),
      ]);

      return { stdout, stderr };
    },
  };
};
