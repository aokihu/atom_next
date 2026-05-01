import { EventEmitter } from "node:events";
import type { RuntimePipelineEvent } from "./events";

export class RuntimeEventBus {
  #emitter = new EventEmitter();

  emit(event: RuntimePipelineEvent) {
    this.#emitter.emit(event.type, event);
    this.#emitter.emit("*", event);
  }

  on<T extends RuntimePipelineEvent["type"]>(
    type: T,
    listener: (event: Extract<RuntimePipelineEvent, { type: T }>) => void,
  ) {
    this.#emitter.on(type, listener as (event: RuntimePipelineEvent) => void);

    return () => {
      this.#emitter.off(type, listener as (event: RuntimePipelineEvent) => void);
    };
  }

  onAny(listener: (event: RuntimePipelineEvent) => void) {
    this.#emitter.on("*", listener);

    return () => {
      this.#emitter.off("*", listener);
    };
  }
}
