/**
 * TUI Client
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.1
 * @description 负责启动 TUI、注入主题，并连接 renderer、store 与根组件。
 */

import { createCliRenderer, type CliRendererConfig } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import { isNullish } from "radashi";
import { TuiApp } from "./app";
import { createTuiApiClient, createTuiStore } from "./model";
import { resolveTuiTheme, type TuiThemeScheme } from "./theme";

/* -------------------- */
/* TUI Startup Types    */
/* -------------------- */

type StartTuiOptions = {
  serverUrl: string;
  workspace: string;
  theme?: string;
};

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
}: StartTuiOptions) => {
  const resolvedTheme = await resolveTuiTheme({
    workspace,
    theme,
  });
  const renderer = await createCliRenderer(
    buildTuiRendererConfig(resolvedTheme),
  );
  const root = createRoot(renderer);
  const store = createTuiStore(createTuiApiClient(serverUrl), {
    serverUrl,
  });
  const signalNames: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
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
  let resolveClose!: () => void;
  const waitForClose = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });

  const cleanupSignals = () => {
    signalNames.forEach((signalName) => {
      process.off(signalName, handleSignal);
    });
  };

  const closeTui = () => {
    if (hasClosed) {
      return;
    }

    hasClosed = true;
    cleanupSignals();
    root.unmount();
    renderer.destroy();
    resolveClose();
  };

  const handleSignal = () => {
    closeTui();
  };

  signalNames.forEach((signalName) => {
    process.once(signalName, handleSignal);
  });

  try {
    // 主题通过 props 注入到根组件，页面内部所有颜色都从同一份 theme 读取。
    root.render(
      createElement(TuiApp, {
        store,
        onExit: closeTui,
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
