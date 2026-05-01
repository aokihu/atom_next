import type { Transport } from "./transport";

export type TransportPort = Pick<Transport, "send">;

export type TransportPayload = {
  systemPrompt: string;
  userPrompt: string;
  options?: Parameters<TransportPort["send"]>[2];
};

export type TransportOutput = Awaited<ReturnType<TransportPort["send"]>>;
