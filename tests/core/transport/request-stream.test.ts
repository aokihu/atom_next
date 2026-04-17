// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { finished } from "node:stream/promises";

import {
  createRequestStreamParser,
  REQUEST_MARKER,
} from "@/core/transport/request-stream";

const runParser = async (chunks: string[]) => {
  const parser = createRequestStreamParser();
  let visibleText = "";

  for (const chunk of chunks) {
    parser.write(chunk);

    while (true) {
      const visibleChunk = parser.read();
      if (visibleChunk === null) break;
      visibleText += String(visibleChunk);
    }
  }

  parser.end();
  await finished(parser, { readable: false });

  while (true) {
    const visibleChunk = parser.read();
    if (visibleChunk === null) break;
    visibleText += String(visibleChunk);
  }

  return {
    visibleText,
    intentRequestText: await parser.intentRequestText,
  };
};

describe("createRequestStreamParser", () => {
  test("passes through all text when request marker is absent", async () => {
    const result = await runParser(["hello", " world"]);

    expect(result).toEqual({
      visibleText: "hello world",
      intentRequestText: "",
    });
  });

  test("splits visible text and request text when marker appears in one chunk", async () => {
    const result = await runParser([
      `hello\n${REQUEST_MARKER}\nrequest-a\nrequest-b`,
    ]);

    expect(result).toEqual({
      visibleText: "hello",
      intentRequestText: "request-a\nrequest-b",
    });
  });

  test("supports request marker split across multiple chunks", async () => {
    const result = await runParser([
      "hello\n<<<REQ",
      "UEST>>>\nrequest-a",
      "\nrequest-b",
    ]);

    expect(result).toEqual({
      visibleText: "hello",
      intentRequestText: "request-a\nrequest-b",
    });
  });

  test("collects full request text when marker is at the beginning", async () => {
    const result = await runParser([`${REQUEST_MARKER}\nrequest-only`]);

    expect(result).toEqual({
      visibleText: "",
      intentRequestText: "request-only",
    });
  });

  test("returns empty request text when marker is at the end", async () => {
    const result = await runParser([`hello${REQUEST_MARKER}`]);

    expect(result).toEqual({
      visibleText: "hello",
      intentRequestText: "",
    });
  });

  test("only splits on the first request marker", async () => {
    const result = await runParser([
      `hello${REQUEST_MARKER}\nrequest-a\n${REQUEST_MARKER}\nrequest-b`,
    ]);

    expect(result).toEqual({
      visibleText: "hello",
      intentRequestText: `request-a\n${REQUEST_MARKER}\nrequest-b`,
    });
  });

  test("flushes incomplete marker prefixes back to visible text when stream ends", async () => {
    const result = await runParser(["hello <<<REQ"]);

    expect(result).toEqual({
      visibleText: "hello <<<REQ",
      intentRequestText: "",
    });
  });
});
