import type {
  PipelineDefinition,
  PipelineResult,
} from "../..";
import type {
  FormalConversationPipelineInput,
  RunFormalConversationPipelineResult,
} from "./types";
import { createFormalConversationPipelineEnv, createFormalConversationPipelineState } from "./types";
import { registerTransportEventHandler } from "./transport-event-handler";
import { createTransportElement } from "../../../elements";
import { syncRuntimeTaskElement } from "./elements/sync-runtime-task.element";
import { exportPromptsElement } from "./elements/export-prompts.element";
import { transformPromptsToTransportPayloadElement } from "./elements/transform-prompts-to-transport-payload.element";
import { transformTransportOutputToConversationOutputElement } from "./elements/transform-transport-output-to-conversation-output.element";
import { handleLengthBoundaryElement } from "./elements/handle-length-boundary.element";
import { handleToolBoundaryElement } from "./elements/handle-tool-boundary.element";
import { parseIntentRequestsElement } from "./elements/parse-intent-requests.element";
import { executeIntentRequestsElement } from "./elements/execute-intent-requests.element";
import { applyIntentRequestExecutionElement } from "./elements/apply-intent-request-execution.element";
import { finalizeConversationElement } from "./elements/finalize-conversation.element";

export const formalConversationPipeline: PipelineDefinition<
  FormalConversationPipelineInput,
  PipelineResult
> = {
  name: "formal-conversation",

  createInput(task, deps) {
    const env = createFormalConversationPipelineEnv(
      task,
      deps.taskQueue,
      deps.runtime,
    );

    const state = createFormalConversationPipelineState();

    return {
      env,
      state,
    };
  },

  createPipeline(deps) {
    return {
      name: "FormalConversation",
      elements: [
        syncRuntimeTaskElement,
        exportPromptsElement,
        transformPromptsToTransportPayloadElement,
        createTransportElement({
          serviceManager: deps.serviceManager,
        }),
        transformTransportOutputToConversationOutputElement,
        handleLengthBoundaryElement,
        handleToolBoundaryElement,
        parseIntentRequestsElement,
        executeIntentRequestsElement,
        applyIntentRequestExecutionElement,
        finalizeConversationElement,
      ],
    };
  },

  setup(eventBus, input) {
    return registerTransportEventHandler(
      eventBus,
      input.env,
      input.state,
    );
  },
};

export type { RunFormalConversationPipelineResult };
