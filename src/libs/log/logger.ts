import type { LogEntry, LogLevel, LogOptions, Logger, LogSource } from "./types";
import { normalizeError } from "./normalize-error";

type CreateLoggerOptions = {
  source: LogSource;
  shouldLog(level: LogLevel): boolean;
  emit(entry: LogEntry): void;
};

const createLogEntry = (
  source: LogSource,
  level: LogLevel,
  message: string,
  options: LogOptions = {},
): LogEntry => {
  return {
    id: crypto.randomUUID(),
    time: Date.now(),
    level,
    source,
    message,
    tags: options.tags,
    data: options.data,
    error: normalizeError(options.error),
  };
};

export const createLogger = ({
  source,
  shouldLog,
  emit,
}: CreateLoggerOptions): Logger => {
  const write = (level: LogLevel, message: string, options?: LogOptions) => {
    if (!shouldLog(level)) {
      return;
    }

    emit(createLogEntry(source, level, message, options));
  };

  return {
    debug(message, options) {
      write("debug", message, options);
    },
    info(message, options) {
      write("info", message, options);
    },
    warn(message, options) {
      write("warn", message, options);
    },
    error(message, options) {
      write("error", message, options);
    },
  };
};
