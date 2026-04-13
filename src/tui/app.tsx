/**
 * TUI App
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.3
 * @description 负责组装 TUI 主界面，协调布局、store 状态与独立的 UI 组件。
 */

import { useEffect, useRef } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { isNullish } from "radashi";
import {
  parseSessionPhaseLabel,
  parseSessionStatusLabel,
  resolveTuiLayout,
  type TuiStore,
} from "./model";
import type { TuiThemeScheme } from "./theme";
import {
  CENTER_PANEL_WIDTH_RATIO,
  DEFAULT_INPUT_LINE_COUNT,
  INPUT_SINGLE_LINE_HEIGHT_THRESHOLD,
  TUI_COLUMN_GAP,
  TUI_EXIT_CONFIRM_TEXT,
  TUI_ROOT_HORIZONTAL_PADDING,
} from "./constants";
import { ConversationPanel } from "./components/conversation-panel";
import { InputPanel } from "./components/input-panel";
import { SessionPanel } from "./components/session-panel";
import { StatusPanel } from "./components/status-panel";

/**
 * 输入区默认提供多行编辑空间，
 * 只有终端高度较小时才压缩成单行，避免挤占消息区。
 */
const parseInputLineCount = (terminalHeight: number) => {
  if (terminalHeight < INPUT_SINGLE_LINE_HEIGHT_THRESHOLD) {
    return 1;
  }

  return DEFAULT_INPUT_LINE_COUNT;
};

/**
 * 布局宽度基于根容器可用宽度计算，
 * 先扣掉左右 padding 和列间距，再按当前中间列 1/2 的规则分配。
 */
const parsePanelWidths = (
  terminalWidth: number,
  showLeftPanel: boolean,
  showRightPanel: boolean,
) => {
  const panelCount = Number(showLeftPanel) + Number(showRightPanel) + 1;
  const gapCount = panelCount - 1;
  const availableWidth =
    terminalWidth - TUI_ROOT_HORIZONTAL_PADDING - gapCount * TUI_COLUMN_GAP;

  if (!showLeftPanel && !showRightPanel) {
    return {
      centerWidth: availableWidth,
      leftWidth: 0,
      rightWidth: 0,
    };
  }

  const centerWidth = Math.floor(availableWidth * CENTER_PANEL_WIDTH_RATIO);
  const sideWidthTotal = availableWidth - centerWidth;

  if (showLeftPanel && showRightPanel) {
    const leftWidth = Math.floor(sideWidthTotal / 2);

    return {
      centerWidth,
      leftWidth,
      rightWidth: sideWidthTotal - leftWidth,
    };
  }

  return {
    centerWidth,
    leftWidth: showLeftPanel ? sideWidthTotal : 0,
    rightWidth: showRightPanel ? sideWidthTotal : 0,
  };
};

type TuiAppProps = {
  store: TuiStore;
  onExit: () => void;
  // 当前启动时选中的完整主题对象。
  theme: TuiThemeScheme;
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
  const inputLineCount = parseInputLineCount(height);
  const panelWidths = parsePanelWidths(
    width,
    layout.showLeftPanel,
    layout.showRightPanel,
  );
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const inputFocused = true;

  useEffect(() => {
    void store.getState().ensureSession();
  }, [store]);

  useEffect(() => {
    if (isNullish(textareaRef.current)) {
      return;
    }

    if (textareaRef.current.plainText !== inputValue) {
      textareaRef.current.setText(inputValue);
    }
  }, [inputValue]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      key.stopPropagation();
      onExit();
    }
  });

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "row",
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
          panelWidth={panelWidths.leftWidth}
          theme={theme}
        />
      ) : null}

      <box
        style={{
          width: panelWidths.centerWidth,
          flexDirection: "column",
        }}
      >
        <ConversationPanel
          messages={messages}
          activeChatStatus={activeChatStatus}
          isSubmitting={isSubmitting}
          isPolling={isPolling}
          theme={theme}
        />
        <InputPanel
          inputLineCount={inputLineCount}
          inputValue={inputValue}
          inputHintText={statusText === TUI_EXIT_CONFIRM_TEXT ? statusText : undefined}
          textareaRef={textareaRef}
          store={store}
          theme={theme}
        />
      </box>

      {layout.showRightPanel ? (
        <StatusPanel
          activeChatStatus={activeChatStatus}
          isSubmitting={isSubmitting}
          isPolling={isPolling}
          statusText={statusText}
          errorText={errorText}
          inputLineCount={inputLineCount}
          panelWidth={panelWidths.rightWidth}
          theme={theme}
        />
      ) : null}
    </box>
  );
};
