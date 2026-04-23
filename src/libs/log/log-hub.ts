import mitt from "mitt";
import type { LogEntry, LogSubscriber } from "./types";

const LOG_HUB_EVENTS = {
  ENTRY_EMITTED: "log.entry.emitted",
} as const;

type LogHubEvents = {
  [LOG_HUB_EVENTS.ENTRY_EMITTED]: LogEntry;
};

export type LogHub = {
  emit(entry: LogEntry): void;
  subscribe(subscriber: LogSubscriber): () => void;
};

export const createLogHub = (): LogHub => {
  const emitter = mitt<LogHubEvents>();

  return {
    emit(entry) {
      emitter.emit(LOG_HUB_EVENTS.ENTRY_EMITTED, entry);
    },
    subscribe(subscriber) {
      emitter.on(LOG_HUB_EVENTS.ENTRY_EMITTED, subscriber);

      return () => {
        emitter.off(LOG_HUB_EVENTS.ENTRY_EMITTED, subscriber);
      };
    },
  };
};
