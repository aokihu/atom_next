//@ts-nockeck
// @ts-nocheck

import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { tryFindAvaliablePort } from "@/libs";

const servers: Array<ReturnType<typeof createServer>> = [];

function listen(host = "127.0.0.1", port = 0) {
  return new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host, port }, () => {
      servers.push(server);
      resolve(server);
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("tryFindAvaliablePort", () => {
  test("returns the start port when it is available", async () => {
    const probe = await listen();
    const address = probe.address();

    if (address === null || typeof address === "string") {
      throw new Error("Failed to get probe address");
    }

    const { port } = address;
    await closeServer(probe);
    servers.pop();

    const [err, availablePort] = await tryFindAvaliablePort(port);

    expect(err).toBeUndefined();
    expect(availablePort).toBe(port);
  });

  test("skips occupied ports and finds the next available one", async () => {
    const occupiedServer = await listen();
    const address = occupiedServer.address();

    if (address === null || typeof address === "string") {
      throw new Error("Failed to get occupied address");
    }

    const [err, availablePort] = await tryFindAvaliablePort(address.port);

    expect(err).toBeUndefined();
    expect(availablePort).toBeGreaterThanOrEqual(address.port);
    expect(availablePort).not.toBe(address.port);
  });

  test("returns the error instead of throwing when start port is invalid", async () => {
    const [err, availablePort] = await tryFindAvaliablePort(0);

    expect(err).toBeInstanceOf(RangeError);
    expect(err?.message).toBe("Invalid start port: 0");
    expect(availablePort).toBeUndefined();
  });
});
