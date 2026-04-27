type AISDKWarningLoggerGlobal = typeof globalThis & {
  AI_SDK_LOG_WARNINGS?: false;
};

/**
 * 关闭 AI SDK 的默认 warning 输出。
 * @description
 * 这些 warning 会直接走 console.warn / console.info，
 * 不属于项目统一日志链路，默认关闭以避免污染 TUI / 终端输出。
 */
export const disableAISDKWarningLogs = () => {
  (globalThis as AISDKWarningLoggerGlobal).AI_SDK_LOG_WARNINGS = false;
};
