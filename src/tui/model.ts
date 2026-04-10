import { create, type StoreApi, type UseBoundStore } from "zustand";
import { sleep, isEmpty, isNullish, isNumber, isPlainObject, isString } from "radashi";
import { ChatStatus, type ChatChunk, type ChatMessage } from "@/types/chat";
import { SessionStatus, type ChatPollResult } from "@/types/session";
import type { UUID } from "@/types";

export const TUI_LEFT_PANEL_BREAKPOINT = 104;
export const TUI_RIGHT_PANEL_BREAKPOINT = 140;
export const TUI_DEFAULT_POLL_INTERVAL_MS = 500;

export type TuiLayout = {
  mode: "center" | "left-center" | "three-column";
  showLeftPanel: boolean;
  showRightPanel: boolean;
};

export type TuiMessage = {
  id: UUID;
  role: "system" | "user" | "assistant" | "error";
  content: string;
  createdAt: number;
  updatedAt: number;
  chatId?: UUID;
  status?: ChatStatus;
};

export type TuiSessionPhase = "idle" | "creating" | "ready" | "error";

type CreateSessionResult = {
  sessionId: UUID;
};

type SubmitChatResult = {
  chatId: UUID;
};

export type TuiApiClient = {
  createSession: () => Promise<UUID>;
  submitChat: (sessionId: UUID, text: string) => Promise<UUID>;
  pollChat: (sessionId: UUID, chatId: UUID) => Promise<ChatPollResult>;
};

type TuiStoreState = {
  serverUrl: string;
  sessionId?: UUID;
  sessionPhase: TuiSessionPhase;
  sessionStatus?: SessionStatus;
  activeChatId?: UUID;
  activeChatStatus?: ChatStatus;
  inputValue: string;
  statusText: string;
  errorText: string;
  messages: TuiMessage[];
  isSubmitting: boolean;
  isPolling: boolean;
};

type TuiStoreActions = {
  setInputValue: (value: string) => void;
  clearError: () => void;
  ensureSession: () => Promise<UUID>;
  sendInput: (rawInput?: string) => Promise<void>;
};

export type TuiStore = UseBoundStore<StoreApi<TuiStoreState & TuiStoreActions>>;

type CreateTuiStoreOptions = {
  serverUrl?: string;
  pollIntervalMs?: number;
};

const buildTuiMessage = (
  role: TuiMessage["role"],
  content: string,
  options: Partial<Pick<TuiMessage, "chatId" | "status">> = {},
): TuiMessage => {
  const now = Date.now();

  return {
    id: Bun.randomUUIDv7(),
    role,
    content,
    createdAt: now,
    updatedAt: now,
    ...options,
  };
};

const parseServerBaseUrl = (serverUrl: string) => {
  const url = new URL(serverUrl);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
};

const parseResponseError = (body: unknown, response: Response) => {
  if (isPlainObject(body)) {
    const errorMessage = (body as Record<string, unknown>).error;

    if (isString(errorMessage) && !isEmpty(errorMessage.trim())) {
      return errorMessage;
    }
  }

  return `HTTP ${response.status}`;
};

const parseResponseJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();

  if (isEmpty(text.trim())) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return {} as T;
  }

  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("server response is not valid JSON");
  }

  if (!response.ok) {
    throw new Error(parseResponseError(body, response));
  }

  return body as T;
};

const parseMessageData = (value: unknown) => {
  if (isNullish(value)) {
    return "";
  }

  if (isString(value)) {
    return value;
  }

  const text = JSON.stringify(value, null, 2);
  return isString(text) ? text : String(value);
};

const parseChunkPreviewText = (chunks?: ChatChunk[]) => {
  if (isNullish(chunks) || chunks.length === 0) {
    return "";
  }

  return chunks.map((chunk) => parseMessageData(chunk.data)).join("");
};

const parseMessagePreviewText = (message?: ChatMessage) => {
  if (isNullish(message)) {
    return "";
  }

  return parseMessageData(message.data);
};

export const parseChatPreviewText = (result: ChatPollResult) => {
  if (result.chatStatus === ChatStatus.COMPLETE) {
    return parseMessagePreviewText(result.message);
  }

  const chunkText = parseChunkPreviewText(result.chunks);

  if (!isEmpty(chunkText)) {
    return chunkText;
  }

  if (result.chatStatus === ChatStatus.FAILED && !isNullish(result.error)) {
    return parseMessageData(result.error.message);
  }

  return "";
};

export const parseSessionStatusLabel = (status?: SessionStatus) => {
  if (status === SessionStatus.ACTIVE) {
    return "active";
  }

  if (status === SessionStatus.IDLE) {
    return "idle";
  }

  if (status === SessionStatus.ARCHIVED) {
    return "archived";
  }

  return "unknown";
};

export const parseSessionPhaseLabel = (phase: TuiSessionPhase) => {
  if (phase === "creating") {
    return "creating";
  }

  if (phase === "ready") {
    return "ready";
  }

  if (phase === "error") {
    return "error";
  }

  return "idle";
};

export const parseChatStatusLabel = (status?: ChatStatus) => {
  if (isNullish(status)) {
    return "idle";
  }

  return status;
};

export const resolveTuiLayout = (terminalWidth: number): TuiLayout => {
  const width = isNumber(terminalWidth) && terminalWidth > 0 ? terminalWidth : 0;

  if (width >= TUI_RIGHT_PANEL_BREAKPOINT) {
    return {
      mode: "three-column",
      showLeftPanel: true,
      showRightPanel: true,
    };
  }

  if (width >= TUI_LEFT_PANEL_BREAKPOINT) {
    return {
      mode: "left-center",
      showLeftPanel: true,
      showRightPanel: false,
    };
  }

  return {
    mode: "center",
    showLeftPanel: false,
    showRightPanel: false,
  };
};

export const createTuiApiClient = (
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): TuiApiClient => {
  const baseUrl = parseServerBaseUrl(serverUrl);

  return {
    createSession: async () => {
      const response = await fetchImpl(new URL("/session", baseUrl), {
        method: "POST",
      });
      const result = await parseResponseJson<CreateSessionResult>(response);
      return result.sessionId;
    },
    submitChat: async (sessionId, text) => {
      const response = await fetchImpl(
        new URL(`/session/${sessionId}/chat`, baseUrl),
        {
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
        },
      );
      const result = await parseResponseJson<SubmitChatResult>(response);
      return result.chatId;
    },
    pollChat: async (sessionId, chatId) => {
      const response = await fetchImpl(
        new URL(`/session/${sessionId}/chat/${chatId}`, baseUrl),
      );
      return await parseResponseJson<ChatPollResult>(response);
    },
  };
};

export const createTuiStore = (
  client: TuiApiClient,
  options: CreateTuiStoreOptions = {},
): TuiStore => {
  const serverUrl = options.serverUrl ?? "";
  const pollIntervalMs = options.pollIntervalMs ?? TUI_DEFAULT_POLL_INTERVAL_MS;
  let sessionTask: Promise<UUID> | undefined;
  let pollSequence = 0;

  const store = create<TuiStoreState & TuiStoreActions>()((set, get) => {
    const appendMessage = (message: TuiMessage) => {
      set((state) => ({
        messages: [...state.messages, message],
      }));
    };

    const updateChatMessage = (
      chatId: UUID,
      content: string,
      status: ChatStatus,
      role: TuiMessage["role"],
    ) => {
      set((state) => {
        let isUpdated = false;
        const nextMessages = state.messages.map((message) => {
          if (message.chatId !== chatId) {
            return message;
          }

          isUpdated = true;

          return {
            ...message,
            role,
            content,
            status,
            updatedAt: Date.now(),
          };
        });

        if (!isUpdated) {
          nextMessages.push(
            buildTuiMessage(role, content, {
              chatId,
              status,
            }),
          );
        }

        return {
          messages: nextMessages,
        };
      });
    };

    const ensureSession = async () => {
      const currentSessionId = get().sessionId;

      if (!isNullish(currentSessionId)) {
        return currentSessionId;
      }

      if (!isNullish(sessionTask)) {
        return await sessionTask;
      }

      set({
        sessionPhase: "creating",
        statusText: "creating session",
        errorText: "",
      });

      sessionTask = (async () => {
        try {
          const sessionId = await client.createSession();

          set({
            sessionId,
            sessionPhase: "ready",
            sessionStatus: SessionStatus.ACTIVE,
            statusText: "session ready",
          });
          appendMessage(buildTuiMessage("system", `session ready: ${sessionId}`));

          return sessionId;
        } catch (error) {
          const errorText =
            error instanceof Error ? error.message : "session create failed";

          set({
            sessionPhase: "error",
            errorText,
            statusText: "session create failed",
          });
          appendMessage(
            buildTuiMessage("error", `session create failed: ${errorText}`),
          );

          throw error;
        } finally {
          sessionTask = undefined;
        }
      })();

      return await sessionTask;
    };

    const pollChatResult = async (sessionId: UUID, chatId: UUID) => {
      const currentSequence = ++pollSequence;

      while (currentSequence === pollSequence) {
        try {
          const result = await client.pollChat(sessionId, chatId);
          const previewText = parseChatPreviewText(result);
          const content =
            result.chatStatus === ChatStatus.FAILED && isEmpty(previewText.trim())
              ? "chat failed"
              : previewText;
          const role = result.chatStatus === ChatStatus.FAILED
            ? "error"
            : "assistant";

          updateChatMessage(chatId, content, result.chatStatus, role);
          set({
            sessionStatus: result.sessionStatus,
            activeChatStatus: result.chatStatus,
            statusText: `chat ${parseChatStatusLabel(result.chatStatus)}`,
          });

          if (
            result.chatStatus === ChatStatus.COMPLETE ||
            result.chatStatus === ChatStatus.FAILED
          ) {
            set({
              isPolling: false,
              activeChatId: undefined,
              activeChatStatus: undefined,
              errorText:
                result.chatStatus === ChatStatus.FAILED
                  ? result.error?.message ?? get().errorText
                  : "",
            });
            return;
          }
        } catch (error) {
          const errorText =
            error instanceof Error ? error.message : "chat poll failed";

          updateChatMessage(chatId, errorText, ChatStatus.FAILED, "error");
          set({
            isPolling: false,
            activeChatId: undefined,
            activeChatStatus: undefined,
            errorText,
            statusText: "chat poll failed",
          });
          return;
        }

        await sleep(pollIntervalMs);
      }
    };

    return {
      serverUrl,
      sessionPhase: "idle",
      inputValue: "",
      statusText: "booting tui",
      errorText: "",
      messages: [
        buildTuiMessage("system", "tui booted"),
      ],
      isSubmitting: false,
      isPolling: false,
      setInputValue: (value) => {
        set({
          inputValue: value,
        });
      },
      clearError: () => {
        set({
          errorText: "",
        });
      },
      ensureSession,
      sendInput: async (rawInput) => {
        const nextInput = isString(rawInput) ? rawInput : get().inputValue;
        const inputText = nextInput.trim();

        if (isEmpty(inputText)) {
          return;
        }

        if (get().isSubmitting || get().isPolling || !isNullish(get().activeChatId)) {
          set({
            errorText: "current chat is still running",
            statusText: "wait for current chat",
          });
          return;
        }

        set({
          isSubmitting: true,
          errorText: "",
          statusText: "submitting chat",
        });

        let sessionId: UUID;

        try {
          sessionId = await ensureSession();
        } catch {
          set({
            isSubmitting: false,
          });
          return;
        }

        appendMessage(buildTuiMessage("user", inputText));
        set({
          inputValue: "",
        });

        try {
          const chatId = await client.submitChat(sessionId, inputText);

          appendMessage(
            buildTuiMessage("assistant", "", {
              chatId,
              status: ChatStatus.WAITING,
            }),
          );
          set({
            isSubmitting: false,
            isPolling: true,
            activeChatId: chatId,
            activeChatStatus: ChatStatus.WAITING,
            statusText: "chat waiting",
          });

          void pollChatResult(sessionId, chatId);
        } catch (error) {
          const errorText =
            error instanceof Error ? error.message : "chat submit failed";

          appendMessage(
            buildTuiMessage("error", `chat submit failed: ${errorText}`),
          );
          set({
            isSubmitting: false,
            errorText,
            statusText: "chat submit failed",
          });
        }
      },
    };
  });

  return store;
};
