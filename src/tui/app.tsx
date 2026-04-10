import { useEffect, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { isEmpty, isNullish, isString } from "radashi";
import {
  parseChatStatusLabel,
  parseSessionPhaseLabel,
  parseSessionStatusLabel,
  resolveTuiLayout,
  type TuiMessage,
  type TuiStore,
} from "./model";

const TUI_THEME = {
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
} as const;

type TuiAppProps = {
  store: TuiStore;
  onExit: () => void;
};

const parseMessageTone = (message: TuiMessage) => {
  if (message.role === "user") {
    return {
      borderColor: TUI_THEME.user,
      titleColor: TUI_THEME.user,
      backgroundColor: TUI_THEME.panelMuted,
    };
  }

  if (message.role === "error") {
    return {
      borderColor: TUI_THEME.danger,
      titleColor: TUI_THEME.danger,
      backgroundColor: TUI_THEME.panel,
    };
  }

  if (message.role === "assistant") {
    return {
      borderColor: TUI_THEME.accent,
      titleColor: TUI_THEME.accent,
      backgroundColor: TUI_THEME.panel,
    };
  }

  return {
    borderColor: TUI_THEME.info,
    titleColor: TUI_THEME.info,
    backgroundColor: TUI_THEME.panel,
  };
};

const parseMessageTitle = (message: TuiMessage) => {
  if (message.role === "user") {
    return "user";
  }

  if (message.role === "assistant") {
    return `assistant · ${parseChatStatusLabel(message.status)}`;
  }

  if (message.role === "error") {
    return `error · ${parseChatStatusLabel(message.status)}`;
  }

  return "system";
};

const parseMessageContent = (message: TuiMessage) => {
  if (!isEmpty(message.content.trim())) {
    return message.content;
  }

  if (!isNullish(message.status)) {
    return `chat ${parseChatStatusLabel(message.status)}...`;
  }

  return "";
};

const SessionPanel = ({
  serverUrl,
  sessionId,
  sessionPhase,
  sessionStatus,
  layoutLabel,
  terminalWidth,
  terminalHeight,
  inputFocused,
}: {
  serverUrl: string;
  sessionId?: string;
  sessionPhase: string;
  sessionStatus: string;
  layoutLabel: string;
  terminalWidth: number;
  terminalHeight: number;
  inputFocused: boolean;
}) => {
  return (
    <box
      title="Session"
      style={{
        width: 28,
        border: true,
        padding: 1,
        flexDirection: "column",
        backgroundColor: TUI_THEME.panel,
        borderColor: TUI_THEME.border,
      }}
    >
      <text fg={TUI_THEME.muted}>{`server: ${serverUrl}`}</text>
      <text fg={TUI_THEME.text}>{`session: ${sessionId ?? "pending"}`}</text>
      <text fg={TUI_THEME.text}>{`phase: ${sessionPhase}`}</text>
      <text fg={TUI_THEME.text}>{`status: ${sessionStatus}`}</text>
      <text fg={TUI_THEME.text}>{`layout: ${layoutLabel}`}</text>
      <text fg={TUI_THEME.text}>{`focus: ${inputFocused ? "input" : "messages"}`}</text>
      <text fg={TUI_THEME.muted}>{`terminal: ${terminalWidth}x${terminalHeight}`}</text>
    </box>
  );
};

const StatusPanel = ({
  activeChatStatus,
  isSubmitting,
  isPolling,
  statusText,
  errorText,
}: {
  activeChatStatus?: string;
  isSubmitting: boolean;
  isPolling: boolean;
  statusText: string;
  errorText: string;
}) => {
  return (
    <box
      title="Status"
      style={{
        width: 28,
        border: true,
        padding: 1,
        flexDirection: "column",
        backgroundColor: TUI_THEME.panel,
        borderColor: TUI_THEME.border,
      }}
    >
      <text fg={TUI_THEME.text}>{`chat: ${activeChatStatus ?? "idle"}`}</text>
      <text fg={TUI_THEME.text}>{`submitting: ${isSubmitting ? "yes" : "no"}`}</text>
      <text fg={TUI_THEME.text}>{`polling: ${isPolling ? "yes" : "no"}`}</text>
      <text fg={TUI_THEME.muted}>{`note: ${statusText}`}</text>
      <text fg={isEmpty(errorText.trim()) ? TUI_THEME.muted : TUI_THEME.danger}>
        {`error: ${isEmpty(errorText.trim()) ? "none" : errorText}`}
      </text>
      <text fg={TUI_THEME.info}>Enter send</text>
      <text fg={TUI_THEME.info}>Tab switch panel</text>
      <text fg={TUI_THEME.info}>Ctrl+C exit</text>
    </box>
  );
};

export const TuiApp = ({ store, onExit }: TuiAppProps) => {
  const serverUrl = store((state) => state.serverUrl);
  const sessionId = store((state) => state.sessionId);
  const sessionPhase = store((state) => state.sessionPhase);
  const sessionStatus = store((state) => state.sessionStatus);
  const activeChatStatus = store((state) => state.activeChatStatus);
  const inputValue = store((state) => state.inputValue);
  const statusText = store((state) => state.statusText);
  const errorText = store((state) => state.errorText);
  const messages = store((state) => state.messages);
  const isSubmitting = store((state) => state.isSubmitting);
  const isPolling = store((state) => state.isPolling);
  const { width, height } = useTerminalDimensions();
  const layout = resolveTuiLayout(width);
  const [inputFocused, setInputFocused] = useState(true);

  useEffect(() => {
    void store.getState().ensureSession();
  }, [store]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      key.stopPropagation();
      onExit();
      return;
    }

    if (key.name === "tab") {
      key.preventDefault();
      key.stopPropagation();
      setInputFocused((current) => !current);
      return;
    }

    if (key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      setInputFocused(true);
    }
  });

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "row",
        padding: 1,
        gap: 1,
        backgroundColor: TUI_THEME.background,
      }}
    >
      {layout.showLeftPanel ? (
        <SessionPanel
          serverUrl={serverUrl}
          sessionId={sessionId}
          sessionPhase={parseSessionPhaseLabel(sessionPhase)}
          sessionStatus={parseSessionStatusLabel(sessionStatus)}
          layoutLabel={layout.mode}
          terminalWidth={width}
          terminalHeight={height}
          inputFocused={inputFocused}
        />
      ) : null}

      <box
        style={{
          flexGrow: 1,
          flexDirection: "column",
          gap: 1,
        }}
      >
        <box
          title="Conversation"
          style={{
            flexGrow: 1,
            border: true,
            padding: 1,
            backgroundColor: TUI_THEME.panel,
            borderColor: TUI_THEME.border,
          }}
        >
          <scrollbox
            focused={!inputFocused}
            stickyScroll
            stickyStart="bottom"
            style={{
              rootOptions: {
                backgroundColor: TUI_THEME.panel,
              },
              wrapperOptions: {
                backgroundColor: TUI_THEME.panel,
              },
              viewportOptions: {
                backgroundColor: TUI_THEME.panel,
              },
              contentOptions: {
                backgroundColor: TUI_THEME.panel,
              },
              scrollbarOptions: {
                trackOptions: {
                  foregroundColor: TUI_THEME.accent,
                  backgroundColor: TUI_THEME.border,
                },
              },
            }}
          >
            {messages.map((message) => {
              const tone = parseMessageTone(message);

              return (
                <box
                  key={message.id}
                  style={{
                    width: "100%",
                    flexDirection: "column",
                    border: true,
                    padding: 1,
                    marginBottom: 1,
                    borderColor: tone.borderColor,
                    backgroundColor: tone.backgroundColor,
                  }}
                >
                  <text fg={tone.titleColor}>{parseMessageTitle(message)}</text>
                  <text fg={TUI_THEME.text} content={parseMessageContent(message)} />
                </box>
              );
            })}
          </scrollbox>
        </box>

        <box
          title={inputFocused ? "Input" : "Input · press Tab to focus"}
          style={{
            border: true,
            height: 3,
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: TUI_THEME.panelMuted,
            borderColor: inputFocused ? TUI_THEME.accent : TUI_THEME.border,
          }}
        >
          <input
            value={inputValue}
            focused={inputFocused}
            placeholder="type message and press Enter"
            onInput={(value) => {
              store.getState().setInputValue(value);
            }}
            onSubmit={(value) => {
              if (isString(value)) {
                void store.getState().sendInput(value);
              }
            }}
          />
        </box>
      </box>

      {layout.showRightPanel ? (
        <StatusPanel
          activeChatStatus={activeChatStatus}
          isSubmitting={isSubmitting}
          isPolling={isPolling}
          statusText={statusText}
          errorText={errorText}
        />
      ) : null}
    </box>
  );
};
