/**
 * Non-blocking observation event bus.
 *
 * PipelineEventBus broadcasts observation events to registered handlers.
 * emit() is synchronous — it never returns a Promise, and handlers cannot
 * be async. This enforces the GStreamer-like bus message contract:
 * observers observe, they don't block or alter pipeline execution.
 *
 * Handler errors are caught internally and reported via onHandlerError
 * so that a failing observer never interrupts the pipeline.
 */
type PipelineEventHandler<TPayload> = (payload: TPayload) => void;

type PipelineEventBusOptions = {
  onHandlerError?: (error: unknown) => void;
};

export class PipelineEventBus<
  TEvents extends Record<string, any>,
> {
  #handlers = new Map<keyof TEvents, Set<PipelineEventHandler<any>>>();
  #options: PipelineEventBusOptions;

  constructor(options: PipelineEventBusOptions = {}) {
    this.#options = options;
  }

  /**
   * Register a handler for the given event.
   * Returns an unsubscribe function to remove the handler.
   */
  public on<TKey extends keyof TEvents>(
    event: TKey,
    handler: PipelineEventHandler<TEvents[TKey]>,
  ) {
    const handlers = this.#handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.#handlers.set(event, handlers);

    return () => {
      const currentHandlers = this.#handlers.get(event);

      if (!currentHandlers) {
        return;
      }

      currentHandlers.delete(handler);

      if (currentHandlers.size === 0) {
        this.#handlers.delete(event);
      }
    };
  }

  /**
   * Emit an event to all registered handlers synchronously.
   * Handler errors are caught and reported via onHandlerError.
   */
  public emit<TKey extends keyof TEvents>(
    event: TKey,
    payload: TEvents[TKey],
  ) {
    const handlers = this.#handlers.get(event);

    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (error) {
        this.#options.onHandlerError?.(error);
      }
    }
  }
}
