import type { LogEntry } from "../types";

export const formatPinoLog = (entry: LogEntry) => {
  const { level, message, ...payload } = entry;

  return {
    level,
    message,
    payload,
  };
};
