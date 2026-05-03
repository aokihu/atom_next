import type { Transport } from "./transport";

export type TransportPort = Pick<Transport, "send">;

type TransportSendOptions = NonNullable<Parameters<TransportPort["send"]>[2]>;

export type TransportPayload = {
  systemPrompt: string;
  userPrompt: string;
  options?: Omit<
    TransportSendOptions,
    "onTextDelta" | "onToolCallStart" | "onToolCallFinish" | "onError"
  >;
};

export type TransportOutput = Awaited<ReturnType<TransportPort["send"]>>;
