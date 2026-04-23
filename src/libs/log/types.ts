export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogSource =
  | "bootstrap"
  | "service-manager"
  | "core"
  | "queue"
  | "runtime"
  | "transport"
  | "api"
  | "tui"
  | "memory"
  | "watchman"
  | string;

export type LogEntryError = {
  name?: string;
  message: string;
  stack?: string;
};

export type LogEntry = {
  id: string;
  time: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  tags?: string[];
  data?: unknown;
  error?: LogEntryError;
};

/**
 * Reserved design note for future `dream` mode.
 *
 * `dream` mode is not a normal observability log stream and should not reuse
 * regular `LogEntry` as a catch-all training data record. Its purpose is to
 * persist selected data for future self-training of skills and memory.
 *
 * Future implementation constraints:
 * - Record only LLM conversation records and runtime context data.
 * - Include Intent Request raw records as part of the context dataset.
 * - Do not record full application logs or every debug/info/warn/error event.
 * - Preserve original data shapes whenever possible; do not format everything
 *   into generic log text.
 * - Use explicit section markers to separate modules such as prompt, context,
 *   intent-request, transport-request, and transport-response.
 * - Save records by time, similar to file logs, but keep the storage boundary
 *   separate from ordinary observability sinks.
 *
 * This is intentionally a design reservation only. `0.11` does not implement
 * dream recording APIs, storage, or runtime behavior.
 */

export type LogOptions = {
  tags?: string[];
  data?: unknown;
  error?: unknown;
};

export type Logger = {
  debug(message: string, options?: LogOptions): void;
  info(message: string, options?: LogOptions): void;
  warn(message: string, options?: LogOptions): void;
  error(message: string, options?: LogOptions): void;
};

export type LogSink = {
  name: string;
  write(entry: LogEntry): void | Promise<void>;
};

export type LogSubscriber = (entry: LogEntry) => void;

export type LogSystemConfig = {
  level?: LogLevel;
  silent?: boolean;
  sinks?: LogSink[];
  enableStdout?: boolean;
  enableFile?: boolean;
  enablePipe?: boolean;
  workspace?: string;
  logsDir?: string;
  pipePath?: string;
};

export type LogSystem = {
  createLogger(source: LogSource): Logger;
  subscribe(subscriber: LogSubscriber): () => void;
};
