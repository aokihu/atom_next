// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { sleep } from "radashi";
import { ChatStatus } from "@/types/chat";
import { SessionStatus } from "@/types/session";
import {
  createTuiApiClient,
  createTuiStore,
  resolveTuiLayout,
} from "@/tui/model";
import {
  parseConversationOutputMessages,
  parseHasStreamingAssistantContent,
  parseShouldRenderConversationLoading,
} from "@/tui/components/conversation-panel";
import {
  BUILTIN_TUI_THEME_NAMES,
  buildTuiRendererConfig,
  getBuiltinTuiTheme,
  getDefaultTuiTheme,
  getTuiThemeWithPatch,
  parseTuiThemePatch,
  resolveTuiTheme,
} from "@/tui";

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
          chatStatus: ChatStatus.COMPLETED,
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
          chatStatus: ChatStatus.COMPLETED,
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
    expect(assistantMessage?.status).toBe(ChatStatus.COMPLETED);
    expect(assistantMessage?.content).toBe("hello world");
  });

  test("filters output messages to user inputs, streaming assistant replies and errors", () => {
    const messages = [
      {
        id: "message-1",
        role: "system",
        content: "booted",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "message-2",
        role: "user",
        content: "hello",
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: "message-3",
        role: "assistant",
        content: "partial",
        status: ChatStatus.PROCESSING,
        createdAt: 3,
        updatedAt: 3,
      },
      {
        id: "message-4",
        role: "assistant",
        content: "done",
        status: ChatStatus.COMPLETED,
        createdAt: 4,
        updatedAt: 4,
      },
      {
        id: "message-5",
        role: "error",
        content: "failed",
        createdAt: 5,
        updatedAt: 5,
      },
    ];

    expect(parseConversationOutputMessages(messages)).toEqual([
      messages[1],
      messages[2],
      messages[3],
      messages[4],
    ]);
  });

  test("detects when streaming assistant content is already visible", () => {
    expect(
      parseHasStreamingAssistantContent([
        {
          id: "message-1",
          role: "assistant",
          content: "",
          status: ChatStatus.PROCESSING,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ).toBe(false);

    expect(
      parseHasStreamingAssistantContent([
        {
          id: "message-1",
          role: "assistant",
          content: "partial output",
          status: ChatStatus.PROCESSING,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ).toBe(true);
  });

  test("renders output loading only before visible streaming content appears", () => {
    expect(
      parseShouldRenderConversationLoading(
        ChatStatus.WAITING,
        false,
        false,
      ),
    ).toBe(true);

    expect(
      parseShouldRenderConversationLoading(
        ChatStatus.PROCESSING,
        false,
        true,
        [
          {
            id: "message-1",
            role: "assistant",
            content: "partial output",
            status: ChatStatus.PROCESSING,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ),
    ).toBe(false);

    expect(
      parseShouldRenderConversationLoading(
        ChatStatus.PROCESSING,
        false,
        true,
        [
          {
            id: "message-1",
            role: "assistant",
            content: "",
            status: ChatStatus.PROCESSING,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ),
    ).toBe(true);

    expect(
      parseShouldRenderConversationLoading(
        ChatStatus.COMPLETED,
        false,
        false,
      ),
    ).toBe(false);

    expect(
      parseShouldRenderConversationLoading(
        undefined,
        false,
        false,
      ),
    ).toBe(false);
  });

  test("returns builtin nord theme", () => {
    expect(getBuiltinTuiTheme("nord")).toEqual({
      background: "#2E3440",
      panel: "#3B4252",
      panelMuted: "#434C5E",
      border: "#4C566A",
      text: "#ECEFF4",
      muted: "#D8DEE9",
      accent: "#88C0D0",
      info: "#81A1C1",
      success: "#A3BE8C",
      warn: "#EBCB8B",
      danger: "#BF616A",
      user: "#8FBCBB",
    });
  });

  test("exposes builtin theme names for config selection", () => {
    expect(BUILTIN_TUI_THEME_NAMES).toEqual([
      "nord",
      "ocean",
      "forest",
      "sunset",
      "paper",
    ]);
  });

  test("returns builtin ocean theme", () => {
    expect(getBuiltinTuiTheme("ocean")).toEqual({
      background: "#0B1F2A",
      panel: "#113346",
      panelMuted: "#18465F",
      border: "#2D6F8E",
      text: "#E8F7FF",
      muted: "#B9D9E8",
      accent: "#4FC3F7",
      info: "#7FDBFF",
      success: "#72E6A6",
      warn: "#FFD166",
      danger: "#FF6B6B",
      user: "#5EEAD4",
    });
  });

  test("parses theme patch with partial tokens", () => {
    expect(
      parseTuiThemePatch({
        background: "#111111",
        accent: "#222222",
      }),
    ).toEqual({
      background: "#111111",
      accent: "#222222",
    });
  });

  test("throws when theme patch contains unsupported token", () => {
    expect(() =>
      parseTuiThemePatch({
        unknown: "#111111",
      }),
    ).toThrow("Unsupported theme token");
  });

  test("merges theme patch onto current base theme", () => {
    expect(
      getTuiThemeWithPatch(getDefaultTuiTheme(), {
        background: "#101010",
        text: "#fafafa",
      }),
    ).toEqual({
      ...getDefaultTuiTheme(),
      background: "#101010",
      text: "#fafafa",
    });
  });

  test("resolves builtin theme from configured name", async () => {
    const warns: string[] = [];
    const theme = await resolveTuiTheme({
      workspace: "/workspace",
      theme: "nord",
      readThemeFile: async () => undefined,
      warn: (message) => {
        warns.push(message);
      },
    });

    expect(theme).toEqual(getDefaultTuiTheme());
    expect(warns).toEqual([]);
  });

  test("resolves user theme patch over builtin theme", async () => {
    const theme = await resolveTuiTheme({
      workspace: "/workspace",
      theme: "nord",
      readThemeFile: async () => ({
        background: "#101010",
        user: "#00ff00",
      }),
    });

    expect(theme).toEqual({
      ...getDefaultTuiTheme(),
      background: "#101010",
      user: "#00ff00",
    });
  });

  test("resolves user theme patch over default theme when builtin theme is missing", async () => {
    const theme = await resolveTuiTheme({
      workspace: "/workspace",
      theme: "custom-forest",
      readThemeFile: async () => ({
        panel: "#123456",
      }),
    });

    expect(theme).toEqual({
      ...getDefaultTuiTheme(),
      panel: "#123456",
    });
  });

  test("falls back to default theme when configured theme is missing", async () => {
    const warns: string[] = [];
    const theme = await resolveTuiTheme({
      workspace: "/workspace",
      theme: "missing",
      readThemeFile: async () => undefined,
      warn: (message) => {
        warns.push(message);
      },
    });

    expect(theme).toEqual(getDefaultTuiTheme());
    expect(warns).toEqual(['Theme "missing" not found, fallback to "nord"']);
  });

  test("falls back to default theme when theme file is invalid", async () => {
    const warns: string[] = [];
    const theme = await resolveTuiTheme({
      workspace: "/workspace",
      theme: "broken",
      readThemeFile: async () => ({
        accent: "",
      }),
      warn: (message) => {
        warns.push(message);
      },
    });

    expect(theme).toEqual(getDefaultTuiTheme());
    expect(warns[0]).toContain('Theme "broken" is invalid, fallback to "nord"');
  });

  test("builds renderer config from current theme background", () => {
    const config = buildTuiRendererConfig({
      ...getDefaultTuiTheme(),
      background: "#010203",
    });

    expect(config.backgroundColor).toBe("#010203");
  });
});
