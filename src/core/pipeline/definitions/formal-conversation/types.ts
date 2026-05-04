import type { PipelineEnqueueTransition, PipelineResult } from "@/core/pipeline";
import type {
  TransportOutput,
  TransportPayload,
} from "@/core/elements/transport.element";
import type { TaskQueue } from "@/core/queue";
import type { Runtime } from "@/core/runtime";
import type { TaskItem } from "@/types/task";

export type FormalConversationPipelineEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
};

export type FormalConversationPipelineState = {
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
};

export type FormalConversationPipelineInput = {
  env: FormalConversationPipelineEnv;
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

type FormalConversationFinalizationBase = {
  env: FormalConversationPipelineEnv;
  transportResult: TransportOutput;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
};

export type FormalConversationFinalizationInput =
  | (FormalConversationFinalizationBase & {
      type: "complete";
    })
  | (FormalConversationFinalizationBase & {
      type: "enqueue";
      transition: PipelineEnqueueTransition;
      nextTask: TaskItem;
    });

export type FormalConversationFlowState =
  | {
      mode: "intent_requests";
      output: FormalConversationConversationOutput;
      intentRequestResult?: ReturnType<Runtime["parseIntentRequest"]>;
      requestExecutionResult?: Awaited<
        ReturnType<Runtime["executeIntentRequests"]>
      >;
    }
  | {
      mode: "ready_to_finalize";
      finalization: FormalConversationFinalizationInput;
    };

export const createFormalConversationPipelineEnv = (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
): FormalConversationPipelineEnv => {
  return {
    task,
    taskQueue,
    runtime,
  };
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

export type RunFormalConversationPipelineResult = PipelineResult;
