//@ts-nockeck

import { describe, expect, test } from "bun:test";
import { sleep } from "radashi";
import { ChatStatus } from "@/types/chat";
import { SessionStatus } from "@/types/session";
import {
  createTuiApiClient,
  createTuiStore,
  resolveTuiLayout,
} from "@/tui/model";

describe("tui model", () => {
  test("resolves responsive panel layout", () => {
    expect(resolveTuiLayout(80)).toEqual({
      mode: "center",
      showLeftPanel: false,
      showRightPanel: false,
    });

    expect(resolveTuiLayout(110)).toEqual({
      mode: "left-center",
      showLeftPanel: true,
      showRightPanel: false,
    });

    expect(resolveTuiLayout(150)).toEqual({
      mode: "three-column",
      showLeftPanel: true,
      showRightPanel: true,
    });
  });

  test("builds api requests from current server endpoints", async () => {
    const requests: Array<{
      url: string;
      method: string;
      body?: unknown;
    }> = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : String(input);

      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ sessionId: "session-1" }), {
          status: 201,
        });
      }

      if (url.endsWith("/chat") && init?.method === "POST") {
        return new Response(JSON.stringify({ chatId: "chat-1" }), {
          status: 201,
        });
      }

      return new Response(
        JSON.stringify({
          sessionId: "session-1",
          sessionStatus: SessionStatus.ACTIVE,
          chatId: "chat-1",
          chatStatus: ChatStatus.COMPLETE,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          message: {
            createdAt: Date.now(),
            data: "done",
          },
        }),
      );
    };

    const client = createTuiApiClient(
      "http://127.0.0.1:8787/",
      fetchMock as typeof fetch,
    );

    const sessionId = await client.createSession();
    const chatId = await client.submitChat(sessionId, "hello");
    await client.pollChat(sessionId, chatId);

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:8787/session",
        method: "POST",
        body: undefined,
      },
      {
        url: "http://127.0.0.1:8787/session/session-1/chat",
        method: "POST",
        body: {
          payload: [
            {
              type: "text",
              data: "hello",
            },
          ],
          channel: {
            domain: "tui",
          },
        },
      },
      {
        url: "http://127.0.0.1:8787/session/session-1/chat/chat-1",
        method: "GET",
        body: undefined,
      },
    ]);
  });

  test("runs a complete tui chat loop with a single active session", async () => {
    let pollCount = 0;
    const client = {
      createSession: async () => "session-1",
      submitChat: async () => "chat-1",
      pollChat: async () => {
        pollCount += 1;

        if (pollCount === 1) {
          return {
            sessionId: "session-1",
            sessionStatus: SessionStatus.ACTIVE,
            chatId: "chat-1",
            chatStatus: ChatStatus.WAITING,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        }

        if (pollCount === 2) {
          return {
            sessionId: "session-1",
            sessionStatus: SessionStatus.ACTIVE,
            chatId: "chat-1",
            chatStatus: ChatStatus.PROCESSING,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            chunks: [
              {
                id: "chunk-1",
                createdAt: Date.now(),
                data: "hello",
              },
              {
                id: "chunk-2",
                createdAt: Date.now(),
                data: " world",
              },
            ],
          };
        }

        return {
          sessionId: "session-1",
          sessionStatus: SessionStatus.ACTIVE,
          chatId: "chat-1",
          chatStatus: ChatStatus.COMPLETE,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          message: {
            createdAt: Date.now(),
            data: "hello world",
          },
        };
      },
    };

    const store = createTuiStore(client, {
      pollIntervalMs: 10,
    });

    store.setState((state) => ({
      ...state,
      serverUrl: "http://127.0.0.1:8787",
    }));
    store.getState().setInputValue("hello");
    await store.getState().sendInput();

    for (let index = 0; index < 40; index += 1) {
      if (!store.getState().isPolling) {
        break;
      }

      await sleep(10);
    }

    const state = store.getState();
    const userMessage = state.messages.find((message) => message.role === "user");
    const assistantMessage = state.messages.find(
      (message) => message.chatId === "chat-1",
    );

    expect(state.sessionId).toBe("session-1");
    expect(state.sessionPhase).toBe("ready");
    expect(state.isPolling).toBe(false);
    expect(state.activeChatId).toBeUndefined();
    expect(userMessage?.content).toBe("hello");
    expect(assistantMessage?.status).toBe(ChatStatus.COMPLETE);
    expect(assistantMessage?.content).toBe("hello world");
  });
});
