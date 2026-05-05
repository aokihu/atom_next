/**
 * FormalConversation pipeline types.
 *
 * Defines the full type chain for the formal conversation pipeline:
 * context → state → input → prompts → transport → output → flow state → finalization.
 *
 * FlowState stages: conversation_output → intent_parsed → intent_executed → ready_to_finalize.
 */
import type { PipelineEnqueueTransition } from "@/core/pipeline";
import type { TaskItem } from "@/types/task";
import type {
  TransportOutput,
  TransportPayload,
} from "@element/transport.element";
import type { FormalConversationPipelineContext } from "./context";

export type FormalConversationPipelineState = {
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
};

export type FormalConversationPipelineInput = {
  context: FormalConversationPipelineContext;
  state: FormalConversationPipelineState;
};

export type FormalConversationPrompts = FormalConversationPipelineInput & {
  systemPrompt: string;
  userPrompt: string;
};

export type FormalConversationTransportInput = FormalConversationPrompts & {
  transportPayload: TransportPayload;
};

export type FormalConversationTransportResponse =
  FormalConversationTransportInput & {
    transportOutput: TransportOutput;
  };

export type FormalConversationConversationOutput =
  FormalConversationPipelineInput & {
    transportResult: TransportOutput;
  };

type FormalConversationFinalizationExtra = {
  transportResult: TransportOutput;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
};

type FormalConversationBaseFinalizationInput = {
  context: FormalConversationPipelineContext;
} & FormalConversationFinalizationExtra;

export type FormalConversationFinalizationInput =
  | ({
      type: "complete";
    } & FormalConversationBaseFinalizationInput)
  | ({
      type: "enqueue";
      transition: PipelineEnqueueTransition;
      nextTask: TaskItem;
    } & FormalConversationBaseFinalizationInput);

export type FormalConversationFlowState =
  | {
      mode: "conversation_output";
      output: FormalConversationConversationOutput;
    }
  | {
      mode: "intent_parsed";
      output: FormalConversationConversationOutput;
      intentRequestResult: ReturnType<
        import("@/core/runtime").Runtime["parseIntentRequest"]
      >;
    }
  | {
      mode: "intent_executed";
      output: FormalConversationConversationOutput;
      intentRequestResult: ReturnType<
        import("@/core/runtime").Runtime["parseIntentRequest"]
      >;
      requestExecutionResult: Awaited<
        ReturnType<import("@/core/runtime").Runtime["executeIntentRequests"]>
      >;
    }
  | {
      mode: "ready_to_finalize";
      finalization: FormalConversationFinalizationInput;
    };

export const createFormalConversationPipelineState =
  (): FormalConversationPipelineState => {
    return {
      visibleTextBuffer: "",
      hasStreamedVisibleOutput: false,
      toolCallStartCount: 0,
      toolCallFinishCount: 0,
      toolFailureMessages: [],
    };
  };
