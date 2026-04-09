/**
 * TUI Client
 * @author aokihu <aokihu@gmail.com>
 * @version 0.4.0
 */

const waitForExitInput = () => {
  return new Promise<void>((resolve) => {
    const stdin = process.stdin;

    const stopWaiting = () => {
      stdin.off("data", handleInput);
      if (stdin.isTTY) {
        stdin.setRawMode?.(false);
      }
      stdin.pause();
      resolve();
    };

    const handleInput = () => {
      stopWaiting();
    };

    if (stdin.isTTY) {
      stdin.setRawMode?.(true);
    }

    stdin.resume();
    stdin.once("data", handleInput);
  });
};

export const startTuiPlaceholder = async (serverUrl: string) => {
  console.log("TUI 已启动");
  console.log(`当前服务器地址: ${serverUrl}`);
  console.log("等待任意输入后退出...");

  await waitForExitInput();
  process.exit(0);
};
