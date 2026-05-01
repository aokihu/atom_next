import type {
  TransportOutput,
  TransportPayload,
} from "@/core/transport";
import type { TaskItem } from "@/types/task";
import type { TaskQueue } from "../../queue";
import type { Runtime } from "../../runtime";

export type FormalConversationWorkflowDecision =
  | { type: "finalize_chat" }
  | { type: "defer_completion" };

export type FormalConversationWorkflowEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
};

export type FormalConversationPrompts = {
  env: FormalConversationWorkflowEnv;
  systemPrompt: string;
  userPrompt: string;
};

export type FormalConversationTransportPayload = {
  env: FormalConversationWorkflowEnv;
  payload: TransportPayload;
};

export type FormalConversationTransportOutputSeed = {
  env: FormalConversationWorkflowEnv;
  output: TransportOutput;
};

export type FormalConversationPipelineState = {
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
};

export const createFormalConversationPipelineState =
  (): FormalConversationPipelineState => ({
    visibleTextBuffer: "",
    hasStreamedVisibleOutput: false,
    toolCallStartCount: 0,
    toolCallFinishCount: 0,
    toolFailureMessages: [],
  });

export type FormalConversationTransportOutput = {
  env: FormalConversationWorkflowEnv;
  transportResult: TransportOutput;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
};

export type ParsedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: TransportOutput;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
  intentRequestResult: ReturnType<Runtime["parseIntentRequest"]>;
};

export type ExecutedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: TransportOutput;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
  requestExecutionResult: Awaited<
    ReturnType<Runtime["executeIntentRequests"]>
  >;
};

export type AppliedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: TransportOutput;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  decision: FormalConversationWorkflowDecision;
};

export type ToolBoundaryResolution =
  | {
      type: "continue_to_intent_requests";
      output: FormalConversationTransportOutput;
    }
  | {
      type: "resolved";
      applied: AppliedIntentRequests;
    };

export type RunFormalConversationWorkflowResult = {
  decision: FormalConversationWorkflowDecision;
};
