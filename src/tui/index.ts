/**
 * TUI Client
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.3
 * @description 负责启动 TUI、注入主题，并连接 renderer、store 与根组件。
 */

import { createCliRenderer, type CliRendererConfig } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import { isEmpty, isNullish } from "radashi";
import { TuiApp } from "./app";
import { TUI_EXIT_CONFIRM_TEXT } from "./constants";
import { createTuiApiClient, createTuiStore } from "./model";
import { resolveTuiTheme, type TuiThemeScheme } from "./theme";
import type { Logger } from "@/libs/log";

/* -------------------- */
/* TUI Startup Types    */
/* -------------------- */

type StartTuiOptions = {
  serverUrl: string;
  workspace: string;
  theme?: string;
  logger?: Logger;
};

const TUI_EXIT_CONFIRM_INTERVAL_MS = 1500;

/**
 * Renderer 自身也需要拿到主题背景色，
 * 否则终端底色会和应用内部 panel 颜色脱节。
 */
export const buildTuiRendererConfig = (
  theme: TuiThemeScheme,
): CliRendererConfig => {
  return {
    exitOnCtrlC: false,
    useMouse: true,
    autoFocus: true,
    consoleMode: "disabled",
    screenMode: "alternate-screen",
    backgroundColor: theme.background,
    useKittyKeyboard: {
      disambiguate: true,
      events: true,
    },
  };
};

/**
 * TUI 启动时先解析主题，再创建 renderer 和 React 根节点。
 * 主题只在启动阶段确定一次，当前版本不做运行时热切换。
 */
export const startTui = async ({
  serverUrl,
  workspace,
  theme,
  logger,
}: StartTuiOptions) => {
  const resolvedTheme = await resolveTuiTheme({
    workspace,
    theme,
    warn: (message) => {
      logger?.warn("TUI theme warning", {
        data: {
          message,
        },
      });
    },
  });
  const renderer = await createCliRenderer(
    buildTuiRendererConfig(resolvedTheme),
  );
  const root = createRoot(renderer);
  const store = createTuiStore(createTuiApiClient(serverUrl), {
    serverUrl,
  });
  const bootMessage = store.getState().messages[0];

  // 启动消息保持和当前 server 连接结果一致，避免继续显示旧的默认文案。
  store.setState({
    messages: isNullish(bootMessage)
      ? []
      : [
          {
            ...bootMessage,
            content: `connected to ${serverUrl}`,
          },
        ],
  });

  let hasClosed = false;
  let lastExitRequestAt = 0;
  let exitConfirmTimer: ReturnType<typeof setTimeout> | undefined;
  let previousStatusText = store.getState().statusText;
  let resolveClose!: () => void;
  const waitForClose = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });

  const clearExitConfirmState = () => {
    lastExitRequestAt = 0;

    if (!isNullish(exitConfirmTimer)) {
      clearTimeout(exitConfirmTimer);
      exitConfirmTimer = undefined;
    }
  };

  const restoreExitConfirmState = () => {
    clearExitConfirmState();
    store.setState((state) => ({
      statusText:
        state.statusText === TUI_EXIT_CONFIRM_TEXT
          ? previousStatusText
          : state.statusText,
    }));
  };

  const cleanupSignals = () => {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
  };

  const closeTui = () => {
    if (hasClosed) {
      return;
    }

    hasClosed = true;
    clearExitConfirmState();
    cleanupSignals();
    root.unmount();
    renderer.destroy();
    resolveClose();
  };

  const requestCloseTui = () => {
    const inputValue = store.getState().inputValue.trim();

    // 输入框里还有内容时，不允许触发退出确认，避免误触 Ctrl+C 丢失用户输入。
    if (!isEmpty(inputValue)) {
      restoreExitConfirmState();
      return;
    }

    const now = Date.now();

    if (now - lastExitRequestAt <= TUI_EXIT_CONFIRM_INTERVAL_MS) {
      closeTui();
      return;
    }

    previousStatusText = store.getState().statusText;
    lastExitRequestAt = now;
    store.setState({
      statusText: TUI_EXIT_CONFIRM_TEXT,
    });

    if (!isNullish(exitConfirmTimer)) {
      clearTimeout(exitConfirmTimer);
    }

    exitConfirmTimer = setTimeout(() => {
      restoreExitConfirmState();
    }, TUI_EXIT_CONFIRM_INTERVAL_MS);
  };

  const handleSigint = () => {
    requestCloseTui();
  };

  const handleSigterm = () => {
    closeTui();
  };

  process.on("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  try {
    // 主题通过 props 注入到根组件，页面内部所有颜色都从同一份 theme 读取。
    root.render(
      createElement(TuiApp, {
        store,
        onExit: requestCloseTui,
        theme: resolvedTheme,
      }),
    );
    await waitForClose;
  } finally {
    if (!hasClosed) {
      closeTui();
    }
  }

  process.exit(0);
};

export {
  BUILTIN_TUI_THEME_NAMES,
  getBuiltinTuiTheme,
  getDefaultTuiTheme,
  getTuiThemeWithPatch,
  parseTuiThemePatch,
  resolveTuiTheme,
} from "./theme";

export type {
  TuiThemeKey,
  TuiThemePatch,
  TuiThemeScheme,
} from "./theme";
