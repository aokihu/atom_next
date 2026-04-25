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
    format: options.format,
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

  const writeJson = (
    level: LogLevel,
    message: string,
    data?: unknown,
    options?: Omit<LogOptions, "data" | "format">,
  ) => {
    write(level, message, {
      ...options,
      data,
      format: "json",
    });
  };

  return {
    debug(message, options) {
      write("debug", message, options);
    },
    debugJson(message, data, options) {
      writeJson("debug", message, data, options);
    },
    info(message, options) {
      write("info", message, options);
    },
    infoJson(message, data, options) {
      writeJson("info", message, data, options);
    },
    warn(message, options) {
      write("warn", message, options);
    },
    warnJson(message, data, options) {
      writeJson("warn", message, data, options);
    },
    error(message, options) {
      write("error", message, options);
    },
    errorJson(message, data, options) {
      writeJson("error", message, data, options);
    },
  };
};
