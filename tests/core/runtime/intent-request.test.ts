// @ts-nocheck
import { describe, expect, test } from "bun:test";

import {
  checkIntentRequestSafety,
  dispatchIntentRequests,
  parseIntentRequests,
} from "@/core/runtime";

describe("parseIntentRequests", () => {
  test("parses search memory request with comma in param value", () => {
    const result = parseIntentRequests(
      '[SEARCH_MEMORY, "搜索与Skill相关的记忆", words=skill,memory;limit=10]',
    );

    expect(result).toEqual([
      {
        request: "SEARCH_MEMORY",
        intent: "搜索与Skill相关的记忆",
        params: {
          words: "skill,memory",
          limit: 10,
        },
      },
    ]);
  });

  test("parses follow up request with empty intent", () => {
    const result = parseIntentRequests(
      '[FOLLOW_UP,"",sessionId=session-1;chatId=chat-1]',
    );

    expect(result).toEqual([
      {
        request: "FOLLOW_UP",
        intent: "",
        params: {
          sessionId: "session-1",
          chatId: "chat-1",
        },
      },
    ]);
  });

  test("parses save memory request with memory scope", () => {
    const result = parseIntentRequests(
      '[SAVE_MEMORY, "保存这段记忆", text=skill cache ready;scope=long]',
    );

    expect(result).toEqual([
      {
        request: "SAVE_MEMORY",
        intent: "保存这段记忆",
        params: {
          text: "skill cache ready",
          scope: "long",
        },
      },
    ]);
  });

  test("parses save memory request with optional summary", () => {
    const result = parseIntentRequests(
      '[SAVE_MEMORY, "保存设计记忆", text=MemoryNode 使用独立存储;summary=MemoryNode 独立存储]',
    );

    expect(result).toEqual([
      {
        request: "SAVE_MEMORY",
        intent: "保存设计记忆",
        params: {
          text: "MemoryNode 使用独立存储",
          summary: "MemoryNode 独立存储",
        },
      },
    ]);
  });

  test("parses load memory request", () => {
    const result = parseIntentRequests(
      '[LOAD_MEMORY, "加载明确记忆", key=long.note.watchman_memory_boundary]',
    );

    expect(result).toEqual([
      {
        request: "LOAD_MEMORY",
        intent: "加载明确记忆",
        params: {
          key: "long.note.watchman_memory_boundary",
        },
      },
    ]);
  });

  test("parses unload memory request with fixed reason", () => {
    const result = parseIntentRequests(
      '[UNLOAD_MEMORY, "卸载已完成回答的记忆", key=long.note.watchman_memory_boundary;reason=answer_completed]',
    );

    expect(result).toEqual([
      {
        request: "UNLOAD_MEMORY",
        intent: "卸载已完成回答的记忆",
        params: {
          key: "long.note.watchman_memory_boundary",
          reason: "answer_completed",
        },
      },
    ]);
  });

  test("parses update memory request", () => {
    const result = parseIntentRequests(
      '[UPDATE_MEMORY, "修正已有记忆正文", key=long.note.watchman_memory_boundary;text=Watchman 不负责 Memory 持久化。]',
    );

    expect(result).toEqual([
      {
        request: "UPDATE_MEMORY",
        intent: "修正已有记忆正文",
        params: {
          key: "long.note.watchman_memory_boundary",
          text: "Watchman 不负责 Memory 持久化。",
        },
      },
    ]);
  });

  test("parses load skill request", () => {
    const result = parseIntentRequests(
      '[LOAD_SKILL, "需要查看技能说明", skill=github:gh-fix-ci]',
    );

    expect(result).toEqual([
      {
        request: "LOAD_SKILL",
        intent: "需要查看技能说明",
        params: {
          skill: "github:gh-fix-ci",
        },
      },
    ]);
  });

  test("ignores request line when closing bracket is missing", () => {
    const result = parseIntentRequests(
      '[SEARCH_MEMORY, "搜索与Skill相关的记忆", words=skill,memory;limit=10',
    );

    expect(result).toEqual([]);
  });

  test("ignores request line when intent is not wrapped by double quotes", () => {
    const result = parseIntentRequests(
      "[SEARCH_MEMORY, 搜索与Skill相关的记忆, words=skill]",
    );

    expect(result).toEqual([]);
  });

  test("ignores request line when request name format is invalid", () => {
    const result = parseIntentRequests(
      '[search_memory, "搜索与Skill相关的记忆", words=skill]',
    );

    expect(result).toEqual([]);
  });

  test("ignores request line when param key is duplicated", () => {
    const result = parseIntentRequests(
      '[SEARCH_MEMORY, "搜索与Skill相关的记忆", words=skill;words=memory]',
    );

    expect(result).toEqual([]);
  });

  test("ignores follow up request when required params are missing", () => {
    const result = parseIntentRequests('[FOLLOW_UP, ""]');

    expect(result).toEqual([]);
  });

  test("ignores search memory request when limit is invalid", () => {
    const result = parseIntentRequests(
      '[SEARCH_MEMORY, "搜索与Skill相关的记忆", words=skill;limit=abc]',
    );

    expect(result).toEqual([]);
  });

  test("ignores save memory request when scope is invalid", () => {
    const result = parseIntentRequests(
      '[SAVE_MEMORY, "保存这段记忆", text=skill cache ready;scope=archive]',
    );

    expect(result).toEqual([]);
  });

  test("ignores unload memory request when reason is invalid", () => {
    const result = parseIntentRequests(
      '[UNLOAD_MEMORY, "卸载记忆", key=long.note.watchman_memory_boundary;reason=custom_reason]',
    );

    expect(result).toEqual([]);
  });

  test("keeps valid requests and skips invalid requests in mixed lines", () => {
    const result = parseIntentRequests(`
[SEARCH_MEMORY, "搜索与Skill相关的记忆", words=skill,memory;limit=10]
[FOLLOW_UP,"",sessionId=session-1;chatId=chat-1]
[INVALID_REQUEST,"",foo=bar]
[SEARCH_MEMORY, "missing bracket"
    `);

    expect(result).toEqual([
      {
        request: "SEARCH_MEMORY",
        intent: "搜索与Skill相关的记忆",
        params: {
          words: "skill,memory",
          limit: 10,
        },
      },
      {
        request: "FOLLOW_UP",
        intent: "",
        params: {
          sessionId: "session-1",
          chatId: "chat-1",
        },
      },
    ]);
  });

  test("supports escaped quotes inside intent text", () => {
    const result = parseIntentRequests(
      '[SEARCH_MEMORY, "搜索 \\"Skill\\" 相关记忆", words=skill]',
    );

    expect(result).toEqual([
      {
        request: "SEARCH_MEMORY",
        intent: '搜索 "Skill" 相关记忆',
        params: {
          words: "skill",
        },
      },
    ]);
  });

  test("rejects follow up request when runtime context mismatches", () => {
    const requests = parseIntentRequests(
      '[FOLLOW_UP,"",sessionId=session-2;chatId=chat-1]',
    );
    const result = checkIntentRequestSafety(requests, {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    expect(result.safeRequests).toEqual([]);
    expect(result.rejectedRequests).toHaveLength(1);
    expect(result.rejectedRequests[0]?.code).toBe(
      "follow_up_session_mismatch",
    );
  });

  test("rejects load skill request when skill name is unsafe", () => {
    const requests = parseIntentRequests(
      '[LOAD_SKILL, "需要查看技能说明", skill=../secret]',
    );
    const result = checkIntentRequestSafety(requests, {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    expect(result.safeRequests).toEqual([]);
    expect(result.rejectedRequests).toHaveLength(1);
    expect(result.rejectedRequests[0]?.code).toBe("skill_name_invalid");
  });

  test("dispatches safe requests into explicit core execution results", () => {
    const requests = parseIntentRequests(`
[SEARCH_MEMORY, "搜索与Skill相关的记忆", words=skill,memory;limit=10]
[LOAD_MEMORY, "加载明确记忆", key=long.note.watchman_memory_boundary]
[UNLOAD_MEMORY, "卸载记忆", key=long.note.watchman_memory_boundary;reason=answer_completed]
[UPDATE_MEMORY, "修正记忆正文", key=long.note.watchman_memory_boundary;text=updated]
[FOLLOW_UP,"",sessionId=session-1;chatId=chat-1]
    `);
    const safetyResult = checkIntentRequestSafety(requests, {
      sessionId: "session-1",
      chatId: "chat-1",
    });
    const dispatchResults = dispatchIntentRequests(safetyResult.safeRequests);

    expect(dispatchResults).toEqual([
      {
        request: {
          request: "SEARCH_MEMORY",
          intent: "搜索与Skill相关的记忆",
          params: {
            words: "skill,memory",
            limit: 10,
          },
        },
        status: "accepted",
        message:
          "SEARCH_MEMORY request accepted and will be executed by Core before follow up scheduling",
      },
      {
        request: {
          request: "LOAD_MEMORY",
          intent: "加载明确记忆",
          params: {
            key: "long.note.watchman_memory_boundary",
          },
        },
        status: "accepted",
        message:
          "LOAD_MEMORY request accepted and will be executed by Core before follow up scheduling",
      },
      {
        request: {
          request: "UNLOAD_MEMORY",
          intent: "卸载记忆",
          params: {
            key: "long.note.watchman_memory_boundary",
            reason: "answer_completed",
          },
        },
        status: "accepted",
        message:
          "UNLOAD_MEMORY request accepted and will be executed by Core after current output finishes",
      },
      {
        request: {
          request: "UPDATE_MEMORY",
          intent: "修正记忆正文",
          params: {
            key: "long.note.watchman_memory_boundary",
            text: "updated",
          },
        },
        status: "accepted",
        message:
          "UPDATE_MEMORY request accepted and will be executed by Core after current output finishes",
      },
      {
        request: {
          request: "FOLLOW_UP",
          intent: "",
          params: {
            sessionId: "session-1",
            chatId: "chat-1",
          },
        },
        status: "accepted",
        message:
          "FOLLOW_UP request accepted and will be scheduled by Core when current output finishes",
      },
    ]);
  });
});
