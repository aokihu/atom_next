import { Pipelog } from "pipelogger";
import type { LogEntry, LogSink } from "../types";

const stringifyLogEntry = (entry: LogEntry) => {
  return JSON.stringify(entry);
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
