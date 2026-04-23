import { createLogHub } from "./log-hub";
import { createLogger as createSourceLogger } from "./logger";
import { createFileSink } from "./sinks/file-sink";
import { createPipeSink } from "./sinks/pipe-sink";
import { createStdoutSink } from "./sinks/stdout-sink";
import { isPromise } from "radashi";
import type {
  LogEntry,
  LogLevel,
  Logger,
  LogSink,
  LogSource,
  LogSubscriber,
  LogSystem,
  LogSystemConfig,
} from "./types";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const shouldLogLevel = (currentLevel: LogLevel, level: LogLevel) => {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentLevel];
};

const resolveLogDir = (config: LogSystemConfig) => {
  if (config.logsDir) {
    return config.logsDir;
  }

  if (config.workspace) {
    return `${config.workspace}/logs`;
  }

  return undefined;
};

const resolveLogPipePath = (config: LogSystemConfig) => {
  if (config.pipePath) {
    return config.pipePath;
  }

  if (config.logsDir) {
    return `${config.logsDir}/atom.log.pipe`;
  }

  if (config.workspace) {
    return `${config.workspace}/logs/atom.log.pipe`;
  }

  return undefined;
};

const createConfiguredSinks = (
  config: LogSystemConfig,
  level: LogLevel,
): LogSink[] => {
  if (config.silent) {
    return [];
  }

  const sinks = [...(config.sinks ?? [])];

  if (config.enableStdout) {
    sinks.push(createStdoutSink(level));
  }

  if (config.enableFile) {
    const logsDir = resolveLogDir(config);
    if (!logsDir) {
      throw new Error("Log directory is required");
    }
    sinks.push(createFileSink(logsDir, level));
  }

  if (config.enablePipe) {
    const pipePath = resolveLogPipePath(config);
    if (!pipePath) {
      throw new Error("Log pipe path is required");
    }
    sinks.push(createPipeSink(pipePath));
  }

  return sinks;
};

const writeSink = (sink: LogSink, entry: LogEntry) => {
  try {
    const result = sink.write(entry);

    if (isPromise(result)) {
      result.catch(() => {});
    }
  } catch {
    // Logging must not break the main execution path.
  }
};

let logSystem: LogSystem | undefined;

const buildLogSystem = (
  config: LogSystemConfig = {},
): LogSystem => {
  const level = config.level ?? "info";
  const hub = createLogHub();
  const sinks = createConfiguredSinks(config, level);

  hub.subscribe((entry) => {
    sinks.forEach((sink) => {
      writeSink(sink, entry);
    });
  });

  const shouldLog = (entryLevel: LogLevel) => {
    return !config.silent && shouldLogLevel(level, entryLevel);
  };

  const emit = (entry: LogEntry) => {
    if (!shouldLog(entry.level)) {
      return;
    }

    hub.emit(entry);
  };

  const createLogger = (source: LogSource): Logger => {
    return createSourceLogger({
      source,
      shouldLog,
      emit,
    });
  };

  const subscribe = (subscriber: LogSubscriber) => {
    return hub.subscribe(subscriber);
  };

  return {
    createLogger,
    subscribe,
  };
};

export const createLogSystem = (
  config: LogSystemConfig = {},
): LogSystem => {
  if (logSystem) {
    throw new Error("LogSystem already initialized");
  }

  logSystem = buildLogSystem(config);
  return logSystem;
};

export const getLogSystem = (): LogSystem => {
  if (!logSystem) {
    throw new Error("LogSystem is not initialized");
  }

  return logSystem;
};

export const resetLogSystem = () => {
  logSystem = undefined;
};
