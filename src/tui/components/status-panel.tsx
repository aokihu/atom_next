/**
 * Status Panel
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.2
 * @description 展示当前消息提交、轮询和错误状态，作为右侧状态面板的独立渲染组件。
 */

import { isEmpty } from "radashi";
import type { TuiThemeScheme } from "../theme";

type StatusPanelProps = {
  activeChatStatus?: string;
  isSubmitting: boolean;
  isPolling: boolean;
  statusText: string;
  errorText: string;
  inputLineCount: number;
  panelWidth: number;
  theme: TuiThemeScheme;
};

/**
 * 右侧状态面板专注展示瞬时状态，
 * 后续如果增加进度骨架屏或 Transport 细节，可以继续沿当前组件扩展。
 */
export const StatusPanel = ({
  activeChatStatus,
  isSubmitting,
  isPolling,
  statusText,
  errorText,
  inputLineCount,
  panelWidth,
  theme,
}: StatusPanelProps) => {
  return (
    <box
      style={{
        width: panelWidth,
        padding: 1,
        flexDirection: "column",
      }}
    >
      <text fg={theme.accent}>Status</text>
      <text fg={theme.text}>{`chat: ${activeChatStatus ?? "idle"}`}</text>
      <text fg={theme.text}>{`submitting: ${isSubmitting ? "yes" : "no"}`}</text>
      <text fg={theme.text}>{`polling: ${isPolling ? "yes" : "no"}`}</text>
      <text fg={theme.muted}>{`note: ${statusText}`}</text>
      <text fg={isEmpty(errorText.trim()) ? theme.muted : theme.danger}>
        {`error: ${isEmpty(errorText.trim()) ? "none" : errorText}`}
      </text>
      <text fg={theme.info}>Enter send</text>
      <text fg={theme.info}>
        {inputLineCount > 1 ? "Shift+Enter newline" : "input always focused"}
      </text>
      <text fg={theme.info}>Ctrl+C exit</text>
    </box>
  );
};
