import type { LogSink } from "../types";
import { formatPrettyLogEntry } from "../formatters/pretty-text";

export const createStdoutSink = (): LogSink => {
  return {
    name: "stdout",
    write(entry) {
      process.stdout.write(`${formatPrettyLogEntry(entry, { color: true })}\n`);
    },
  };
};
