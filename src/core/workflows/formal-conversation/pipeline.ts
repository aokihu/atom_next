import { createPipeline } from "@/core/pipeline";
import { applyIntentRequestExecutionElement } from "./elements/apply-intent-request-execution.element";
import { executeIntentRequestsElement } from "./elements/execute-intent-requests.element";
import { exportPromptsElement } from "./elements/export-prompts.element";
import { finalizeConversationElement } from "./elements/finalize-conversation.element";
import { handleToolBoundaryElement } from "./elements/handle-tool-boundary.element";
import { parseIntentRequestsElement } from "./elements/parse-intent-requests.element";
import { sendConversationElement } from "./elements/send-conversation.element";
import { syncRuntimeTaskElement } from "./elements/sync-runtime-task.element";
import type {
  FormalConversationWorkflowEnv,
  FormalConversationTransportOutput,
  RunFormalConversationWorkflowResult,
  ToolBoundaryResolution,
} from "./types";

export const formalConversationPrepareAndTransportPipeline = createPipeline<
  FormalConversationWorkflowEnv,
  ToolBoundaryResolution
>({
  name: "formal_conversation.prepare_and_transport",
  elements: [
    syncRuntimeTaskElement,
    exportPromptsElement,
    sendConversationElement,
    handleToolBoundaryElement,
  ],
});

export const formalConversationIntentRequestPipeline = createPipeline<
  FormalConversationTransportOutput,
  RunFormalConversationWorkflowResult
>({
  name: "formal_conversation.intent_requests",
  elements: [
    parseIntentRequestsElement,
    executeIntentRequestsElement,
    applyIntentRequestExecutionElement,
    finalizeConversationElement,
  ],
});
