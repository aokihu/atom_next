import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ToolService } from "@/services";

describe("ToolService", () => {
  test("createExecutionContext throws when workspace is missing", () => {
    const service = new ToolService();

    expect(() => {
      service.createExecutionContext({});
    }).toThrow("Tool execution workspace is required");
  });

  test("createToolRegistry returns builtin read-only tools", () => {
    const service = new ToolService();
    const context = service.createExecutionContext({
      workspace: "/tmp",
    });
    const registry = service.createToolRegistry({
      context,
    });

    expect(Object.keys(registry)).toEqual([
      "read",
      "ls",
      "tree",
      "ripgrep",
      "write",
      "cp",
      "mv",
      "bash",
      "git",
    ]);
  });

  test("createToolRegistry throws on additional tool name conflict", () => {
    const service = new ToolService();
    const context = service.createExecutionContext({
      workspace: "/tmp",
    });

    expect(() => {
      service.createToolRegistry({
        context,
        additionalTools: {
          read: {
            description: "conflict",
            inputSchema: z.object({}),
            execute: async () => ({}),
          },
        },
      });
    }).toThrow("Tool name conflict: read");
  });
});
