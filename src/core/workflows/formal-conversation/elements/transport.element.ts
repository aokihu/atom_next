import { createTransportElement } from "@/core/elements";
import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import type { TransportPort } from "@/core/transport";
import type {
  FormalConversationTransportOutputSeed,
  FormalConversationTransportPayload,
} from "../types";

export const createFormalConversationTransportElement = (
  transport: TransportPort,
) => {
  const transportElement = createTransportElement(transport);

  return {
    name: "transport",

    async process(
      input: FormalConversationTransportPayload,
      context: PipelineContext,
    ): Promise<FormalConversationTransportOutputSeed> {
      const output = await transportElement.process(input.payload, context);

      return {
        env: input.env,
        output,
      };
    },
  } satisfies PipelineElement<
    FormalConversationTransportPayload,
    FormalConversationTransportOutputSeed
  >;
};
