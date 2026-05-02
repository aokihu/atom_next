type PipelineEventHandler<TPayload> = (
  payload: TPayload,
) => void | Promise<void>;

export class PipelineEventBus<
  TEvents extends Record<string, any>,
> {
  #handlers = new Map<keyof TEvents, Set<PipelineEventHandler<any>>>();

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

  public async emit<TKey extends keyof TEvents>(
    event: TKey,
    payload: TEvents[TKey],
  ) {
    const handlers = this.#handlers.get(event);

    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      await handler(payload);
    }
  }
}
