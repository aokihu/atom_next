import pino from "pino";
import { join } from "node:path";
import type { Logger as PinoLogger } from "pino";
import type { LogLevel, LogSink } from "../types";
import { formatPinoLog } from "../formatters/pino-format";

type PinoDestination = ReturnType<typeof pino.destination>;

const padDatePart = (value: number) => {
  return String(value).padStart(2, "0");
};

export const parseLogDate = (date: Date) => {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join("-");
};

export const parseLogFilePath = (logsDir: string, date = new Date()) => {
  return join(logsDir, `atom-${parseLogDate(date)}.log.jsonl`);
};

export const createFileSink = (
  logsDir: string,
  level: LogLevel = "debug",
): LogSink => {
  let currentFilePath = "";
  let logger: PinoLogger | undefined;
  let destination: PinoDestination | undefined;

  const closeDestination = () => {
    try {
      destination?.end();
    } catch {
      // Sink cleanup must not affect logging.
    }
  };

  const getLogger = (time: number) => {
    const filePath = parseLogFilePath(logsDir, new Date(time));

    if (logger && currentFilePath === filePath) {
      return logger;
    }

    currentFilePath = filePath;
    closeDestination();
    destination = pino.destination({
      dest: filePath,
      mkdir: true,
      sync: false,
    });
    logger = pino(
      { level },
      destination,
    );

    return logger;
  };

  return {
    name: "file",
    write(entry) {
      const formatted = formatPinoLog(entry);
      getLogger(entry.time)[formatted.level](
        formatted.payload,
        formatted.message,
      );
    },
  };
};
