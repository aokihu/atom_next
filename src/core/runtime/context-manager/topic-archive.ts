import { createHash } from "node:crypto";
import type { RuntimeMemoryItem } from "../memory-item";
import type { RuntimeConversationContext } from "./types";

const TOPIC_ARCHIVE_SUMMARY_MAX_CHARS = 480;

const clampText = (text: string, maxChars: number) => {
  if (text.length <= maxChars) {
    return text.trim();
  }

  return text.slice(0, maxChars).trim();
};

const createTopicArchiveMemoryKey = (summary: string) => {
  const hash = createHash("sha1").update(summary).digest("hex").slice(0, 12);
  return `runtime.short.topic_archive.${hash}`;
};

export const createTopicArchiveSummary = (
  conversation: RuntimeConversationContext,
) => {
  const parts = [
    "上一话题摘要：",
    `- 用户输入：${conversation.lastUserInput.trim()}`,
    `- 助手输出：${conversation.lastAssistantOutput.trim()}`,
  ];

  return clampText(parts.join("\n"), TOPIC_ARCHIVE_SUMMARY_MAX_CHARS);
};

export const createTopicArchiveMemoryItem = (
  summary: string,
): RuntimeMemoryItem => {
  const now = Date.now();

  return {
    memory: {
      key: createTopicArchiveMemoryKey(summary),
      text: summary,
      meta: {
        created_at: now,
        updated_at: now,
        score: 100,
        status: "active",
        confidence: 1,
        type: "note",
      },
    },
    retrieval: {
      mode: "context",
      relevance: 1,
      reason: "Archived previous session conversation due to topic change",
    },
    links: [],
  };
};
