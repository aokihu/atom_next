import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolService } from "@/services";
import {
  ToolBudgetExceededError,
  ToolPolicyBlockedError,
  type ToolOutputMessage,
} from "@/services/tools";

const createWorkspace = async () => {
  const workspace = await mkdtemp(join(tmpdir(), "atom-next-tools-registry-"));
  await writeFile(join(workspace, "note.txt"), "hello\nworld");
  return workspace;
};

const executeTool = (
  service: ToolService,
  context: ReturnType<ToolService["createExecutionContext"]>,
  toolName: string,
  toolInput: unknown,
) => {
  return service.executeTool({
    context,
    toolName,
    toolInput,
  });
};

describe("ToolService registry", () => {
  test("blocks execution when budget is exceeded", async () => {
    const workspace = await createWorkspace();

    try {
      const service = new ToolService();
      const context = service.createExecutionContext({
        workspace,
        toolBudget: {
          tryConsume: () => ({
            ok: false,
            used: 1,
            remaining: 0,
            limit: 1,
            toolName: "read",
          }),
        },
      });

      await expect(
        executeTool(service, context, "read", {
          filepath: join(workspace, "note.txt"),
        }),
      ).rejects.toBeInstanceOf(ToolBudgetExceededError);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("blocks execution when guard rejects tool call", async () => {
    const workspace = await createWorkspace();

    try {
      const messages: ToolOutputMessage[] = [];
      const service = new ToolService();
      const context = service.createExecutionContext({
        workspace,
        onOutputMessage: (message) => {
          messages.push(message);
        },
        beforeToolExecution: () => ({
          allow: false,
          reason: "tool blocked",
        }),
      });

      await expect(
        executeTool(service, context, "read", {
          filepath: join(workspace, "note.txt"),
        }),
      ).rejects.toBeInstanceOf(ToolPolicyBlockedError);

      expect(messages).toEqual([
        {
          category: "tool",
          type: "tool.call",
          toolName: "read",
          toolCallId: undefined,
          inputSummary: expect.any(String),
        },
        {
          category: "tool",
          type: "tool.result",
          toolName: "read",
          toolCallId: undefined,
          ok: false,
          errorMessage: "tool blocked",
        },
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("emits settled hook for success and semantic failure", async () => {
    const workspace = await createWorkspace();

    try {
      const events: Array<{
        toolName: string;
        ok: boolean;
        result?: unknown;
        error?: unknown;
      }> = [];
      const service = new ToolService();
      const context = service.createExecutionContext({
        workspace,
        onToolExecutionSettled: (event) => {
          events.push(event);
        },
      });

      await executeTool(service, context, "read", {
        filepath: join(workspace, "note.txt"),
      });
      await executeTool(service, context, "read", {
        filepath: join(workspace, "missing.txt"),
      });

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        toolName: "read",
        ok: true,
      });
      expect(events[1]).toMatchObject({
        toolName: "read",
        ok: false,
        error: "The file does not exist, check filepath",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
