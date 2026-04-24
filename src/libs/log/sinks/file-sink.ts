import { join } from "node:path";
import { createWriteStream, mkdirSync } from "node:fs";
import type { WriteStream } from "node:fs";
import type { LogSink } from "../types";

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

export const createFileSink = (logsDir: string): LogSink => {
  let currentFilePath = "";
  let stream: WriteStream | undefined;

  const closeStream = () => {
    try {
      stream?.end();
    } catch {
      // Sink cleanup must not affect logging.
    }
  };

  const getStream = (time: number) => {
    const filePath = parseLogFilePath(logsDir, new Date(time));

    if (stream && currentFilePath === filePath) {
      return stream;
    }

    currentFilePath = filePath;
    closeStream();
    mkdirSync(logsDir, {
      recursive: true,
    });
    stream = createWriteStream(filePath, {
      flags: "a",
    });

    return stream;
  };

  return {
    name: "file",
    write(entry) {
      getStream(entry.time).write(`${JSON.stringify(entry)}\n`);
    },
  };
};
