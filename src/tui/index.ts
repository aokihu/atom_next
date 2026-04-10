/**
 * TUI Client
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.0
 */

import { createCliRenderer, type CliRendererConfig } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import { isNullish } from "radashi";
import { TuiApp } from "./app";
import { createTuiApiClient, createTuiStore } from "./model";

export const buildTuiRendererConfig = (): CliRendererConfig => {
  return {
    exitOnCtrlC: false,
    useMouse: true,
    autoFocus: true,
    consoleMode: "disabled",
    screenMode: "alternate-screen",
    backgroundColor: "#2E3440",
    useKittyKeyboard: {
      disambiguate: true,
      events: true,
    },
  };
};

export const startTui = async (serverUrl: string) => {
  const renderer = await createCliRenderer(buildTuiRendererConfig());
  const root = createRoot(renderer);
  const store = createTuiStore(createTuiApiClient(serverUrl), {
    serverUrl,
  });
  const signalNames: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  const bootMessage = store.getState().messages[0];

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
    root.render(createElement(TuiApp, { store, onExit: closeTui }));
    await waitForClose;
  } finally {
    if (!hasClosed) {
      closeTui();
    }
  }

  process.exit(0);
};
