import { Pipelog } from "pipelogger";
import type { LogEntry, LogSink } from "../types";
import { formatPrettyLogEntry } from "../formatters/pretty-text";

const stringifyLogEntry = (entry: LogEntry) => {
  return formatPrettyLogEntry(entry, { color: true });
};

export const createPipeSink = (pipePath: string): LogSink => {
  const pipe = Pipelog.factory(pipePath);

  return {
    name: "pipe",
    write(entry) {
      pipe.log(stringifyLogEntry(entry));
    },
  };
};
