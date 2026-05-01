import type { TaskItem } from "@/types/task";
import type { TaskQueue } from "../../queue";
import type { Runtime } from "../../runtime";
import type { Transport } from "../../transport";

export type FormalConversationWorkflowDecision =
  | { type: "finalize_chat" }
  | { type: "defer_completion" };

export type FormalConversationWorkflowEnv = {
  task: TaskItem;
  taskQueue: TaskQueue;
  runtime: Runtime;
  transport: Transport;
};

export type FormalConversationPrompts = {
  env: FormalConversationWorkflowEnv;
  systemPrompt: string;
  userPrompt: string;
};

export type FormalConversationTransportOutput = {
  env: FormalConversationWorkflowEnv;
  transportResult: Awaited<ReturnType<Transport["send"]>>;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
};

export type ParsedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: Awaited<ReturnType<Transport["send"]>>;
  visibleTextBuffer: string;
  hasStreamedVisibleOutput: boolean;
  toolCallStartCount: number;
  toolCallFinishCount: number;
  toolFailureMessages: string[];
  intentRequestResult: ReturnType<Runtime["parseIntentRequest"]>;
};

export type ExecutedIntentRequests = {
  env: FormalConversationWorkflowEnv;
  transportResult: Awaited<ReturnType<Transport["send"]>>;
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
  transportResult: Awaited<ReturnType<Transport["send"]>>;
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
