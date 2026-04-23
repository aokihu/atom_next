import pino from "pino";
import type { LogLevel, LogSink } from "../types";
import { formatPinoLog } from "../formatters/pino-format";

export const createStdoutSink = (level: LogLevel = "debug"): LogSink => {
  const logger = pino({ level }, pino.destination(1));

  return {
    name: "stdout",
    write(entry) {
      const formatted = formatPinoLog(entry);
      logger[formatted.level](formatted.payload, formatted.message);
    },
  };
};
