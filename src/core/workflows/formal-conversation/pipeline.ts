import { createPipeline } from "@/core/pipeline";
import type { TransportPort } from "@/core/transport";
import { applyIntentRequestExecutionElement } from "./elements/apply-intent-request-execution.element";
import { executeIntentRequestsElement } from "./elements/execute-intent-requests.element";
import { exportPromptsElement } from "./elements/export-prompts.element";
import { finalizeConversationElement } from "./elements/finalize-conversation.element";
import { handleToolBoundaryElement } from "./elements/handle-tool-boundary.element";
import { parseIntentRequestsElement } from "./elements/parse-intent-requests.element";
import { syncRuntimeTaskElement } from "./elements/sync-runtime-task.element";
import { createFormalConversationTransportElement } from "./elements/transport.element";
import { createTransformTransportOutputToConversationOutputElement } from "./elements/transform-transport-output-to-conversation-output.element";
import { transformPromptsToTransportPayloadElement } from "./elements/transform-prompts-to-transport-payload.element";
import type {
  FormalConversationPipelineState,
  FormalConversationWorkflowEnv,
  FormalConversationTransportOutput,
  RunFormalConversationWorkflowResult,
  ToolBoundaryResolution,
} from "./types";

export const createFormalConversationPrepareAndTransportPipeline = (deps: {
  transport: TransportPort;
  state: FormalConversationPipelineState;
}) =>
  createPipeline<FormalConversationWorkflowEnv, ToolBoundaryResolution>({
    name: "formal_conversation.prepare_and_transport",
    elements: [
      syncRuntimeTaskElement,
      exportPromptsElement,
      transformPromptsToTransportPayloadElement,
      createFormalConversationTransportElement(deps.transport),
      createTransformTransportOutputToConversationOutputElement(deps.state),
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
