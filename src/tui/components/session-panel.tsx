/**
 * Session Panel
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.2
 * @description 展示当前 TUI 会话、连接和终端布局信息，方便在侧栏快速观察运行状态。
 */

import type { TuiThemeScheme } from "../theme";

type SessionPanelProps = {
  serverUrl: string;
  sessionId?: string;
  sessionPhase: string;
  sessionStatus: string;
  layoutLabel: string;
  terminalWidth: number;
  terminalHeight: number;
  inputFocused: boolean;
  panelWidth: number;
  theme: TuiThemeScheme;
};

/**
 * 左侧会话面板保留调试所需的核心上下文，
 * 这样后续新增状态字段时只需要扩展当前组件，不必继续堆回根组件。
 */
export const SessionPanel = ({
  serverUrl,
  sessionId,
  sessionPhase,
  sessionStatus,
  layoutLabel,
  terminalWidth,
  terminalHeight,
  inputFocused,
  panelWidth,
  theme,
}: SessionPanelProps) => {
  return (
    <box
      style={{
        width: panelWidth,
        padding: 1,
        flexDirection: "column",
      }}
    >
      <text fg={theme.accent}>Session</text>
      <text fg={theme.muted}>{`server: ${serverUrl}`}</text>
      <text fg={theme.text}>{`session: ${sessionId ?? "pending"}`}</text>
      <text fg={theme.text}>{`phase: ${sessionPhase}`}</text>
      <text fg={theme.text}>{`status: ${sessionStatus}`}</text>
      <text fg={theme.text}>{`layout: ${layoutLabel}`}</text>
      <text fg={theme.text}>{`focus: ${inputFocused ? "input" : "messages"}`}</text>
      <text fg={theme.muted}>{`terminal: ${terminalWidth}x${terminalHeight}`}</text>
    </box>
  );
};
