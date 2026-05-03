import { ChatStatus } from "@/types/chat";
import type { ChatPollResult } from "@/types/session";
import { parseResponseJson } from "./http";

const CHAT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const createSession = async (baseUrl: string) => {
  const response = await fetch(`${baseUrl}/session`, {
    method: "POST",
  });
  const result = await parseResponseJson<{ sessionId: string }>(response);
  return result.sessionId;
};

export const submitTextChat = async (
  baseUrl: string,
  sessionId: string,
  text: string,
) => {
  const response = await fetch(`${baseUrl}/session/${sessionId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payload: [
        {
          type: "text",
          data: text,
        },
      ],
      channel: {
        domain: "tui",
      },
    }),
  });
  const result = await parseResponseJson<{ chatId: string }>(response);
  return result.chatId;
};

export const pollChat = async (
  baseUrl: string,
  sessionId: string,
  chatId: string,
) => {
  const response = await fetch(`${baseUrl}/session/${sessionId}/chat/${chatId}`);
  return await parseResponseJson<ChatPollResult>(response);
};

export const pollChatUntilSettled = async (
  baseUrl: string,
  sessionId: string,
  chatId: string,
) => {
  const startedAt = Date.now();
  let lastResult: ChatPollResult | undefined;

  while (Date.now() - startedAt < CHAT_TIMEOUT_MS) {
    const result = await pollChat(baseUrl, sessionId, chatId);
    lastResult = result;

    if (result.chatStatus === ChatStatus.COMPLETED) {
      return result;
    }

    if (result.chatStatus === ChatStatus.FAILED) {
      const message = result.error?.message ?? "Unknown chat failure";
      throw new Error(`Chat failed: ${message}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for chat completion. Last status: ${lastResult?.chatStatus ?? "unknown"}`,
  );
};
