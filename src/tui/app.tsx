/**
 * TUI App
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.1
 * @description 负责渲染 TUI 主界面，包括会话面板、消息列表、输入区和状态面板。
 */

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
import type { TuiThemeScheme } from "./theme";

/* -------------------- */
/* Component Props      */
/* -------------------- */

type TuiAppProps = {
  store: TuiStore;
  onExit: () => void;
  // 当前启动时选中的完整主题对象。
  theme: TuiThemeScheme;
};

/**
 * 不同消息角色使用不同的视觉语义，
 * 但具体颜色全部从外部主题读取，组件本身不再持有硬编码颜色。
 */
const parseMessageTone = (message: TuiMessage, theme: TuiThemeScheme) => {
  if (message.role === "user") {
    return {
      borderColor: theme.user,
      titleColor: theme.user,
      backgroundColor: theme.panelMuted,
    };
  }

  if (message.role === "error") {
    return {
      borderColor: theme.danger,
      titleColor: theme.danger,
      backgroundColor: theme.panel,
    };
  }

  if (message.role === "assistant") {
    return {
      borderColor: theme.accent,
      titleColor: theme.accent,
      backgroundColor: theme.panel,
    };
  }

  return {
    borderColor: theme.info,
    titleColor: theme.info,
    backgroundColor: theme.panel,
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

/**
 * 左侧会话面板展示当前连接和终端上下文，
 * 主要用于调试 TUI 当前的运行状态。
 */
const SessionPanel = ({
  serverUrl,
  sessionId,
  sessionPhase,
  sessionStatus,
  layoutLabel,
  terminalWidth,
  terminalHeight,
  inputFocused,
  theme,
}: {
  serverUrl: string;
  sessionId?: string;
  sessionPhase: string;
  sessionStatus: string;
  layoutLabel: string;
  terminalWidth: number;
  terminalHeight: number;
  inputFocused: boolean;
  theme: TuiThemeScheme;
}) => {
  return (
    <box
      title="Session"
      style={{
        width: 28,
        border: true,
        padding: 1,
        flexDirection: "column",
        backgroundColor: theme.panel,
        borderColor: theme.border,
      }}
    >
      <text fg={theme.muted}>{`server: ${serverUrl}`}</text>
      <text fg={theme.text}>{`session: ${sessionId ?? "pending"}`}</text>
      <text fg={theme.text}>{`phase: ${sessionPhase}`}</text>
      <text fg={theme.text}>{`status: ${sessionStatus}`}</text>
      <text fg={theme.text}>{`layout: ${layoutLabel}`}</text>
      <text fg={theme.text}>
        {`focus: ${inputFocused ? "input" : "messages"}`}
      </text>
      <text fg={theme.muted}>{`terminal: ${terminalWidth}x${terminalHeight}`}</text>
    </box>
  );
};

/**
 * 右侧状态面板展示提交、轮询和错误等即时状态，
 * 方便在调试阶段观察当前 TUI 的动作反馈。
 */
const StatusPanel = ({
  activeChatStatus,
  isSubmitting,
  isPolling,
  statusText,
  errorText,
  theme,
}: {
  activeChatStatus?: string;
  isSubmitting: boolean;
  isPolling: boolean;
  statusText: string;
  errorText: string;
  theme: TuiThemeScheme;
}) => {
  return (
    <box
      title="Status"
      style={{
        width: 28,
        border: true,
        padding: 1,
        flexDirection: "column",
        backgroundColor: theme.panel,
        borderColor: theme.border,
      }}
    >
      <text fg={theme.text}>{`chat: ${activeChatStatus ?? "idle"}`}</text>
      <text fg={theme.text}>
        {`submitting: ${isSubmitting ? "yes" : "no"}`}
      </text>
      <text fg={theme.text}>{`polling: ${isPolling ? "yes" : "no"}`}</text>
      <text fg={theme.muted}>{`note: ${statusText}`}</text>
      <text fg={isEmpty(errorText.trim()) ? theme.muted : theme.danger}>
        {`error: ${isEmpty(errorText.trim()) ? "none" : errorText}`}
      </text>
      <text fg={theme.info}>Enter send</text>
      <text fg={theme.info}>Tab switch panel</text>
      <text fg={theme.info}>Ctrl+C exit</text>
    </box>
  );
};

/**
 * TUI 根组件只负责读取 store 并渲染界面，
 * 颜色语义和主题 token 都从启动时注入的 theme 统一获取。
 */
export const TuiApp = ({ store, onExit, theme }: TuiAppProps) => {
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
        backgroundColor: theme.background,
      }}
    >
      {/* 左侧信息面板按布局断点按需显示，避免窄终端压缩主交互区。 */}
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
          theme={theme}
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
            backgroundColor: theme.panel,
            borderColor: theme.border,
          }}
        >
          <scrollbox
            focused={!inputFocused}
            stickyScroll
            stickyStart="bottom"
            style={{
              rootOptions: {
                backgroundColor: theme.panel,
              },
              wrapperOptions: {
                backgroundColor: theme.panel,
              },
              viewportOptions: {
                backgroundColor: theme.panel,
              },
              contentOptions: {
                backgroundColor: theme.panel,
              },
              scrollbarOptions: {
                trackOptions: {
                  foregroundColor: theme.accent,
                  backgroundColor: theme.border,
                },
              },
            }}
          >
            {messages.map((message) => {
              const tone = parseMessageTone(message, theme);

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
                  <text fg={theme.text} content={parseMessageContent(message)} />
                </box>
              );
            })}
          </scrollbox>
        </box>

        {/* 输入区和消息区共用同一份主题 token，这样切换主题时视觉风格能整体保持一致。 */}
        <box
          title={inputFocused ? "Input" : "Input · press Tab to focus"}
          style={{
            border: true,
            height: 3,
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: theme.panelMuted,
            borderColor: inputFocused ? theme.accent : theme.border,
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
          theme={theme}
        />
      ) : null}
    </box>
  );
};
