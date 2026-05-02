import type { TaskItem } from "@/types/task";
import type { TaskQueue } from "../queue";
import type { Runtime } from "../runtime";
import type { Transport } from "../transport";
import {
  PipelineEventBus,
  PipelineRunner,
  type PipelineEventMap,
  type Pipeline,
} from "../pipeline";
import { createTransportElement } from "../elements";
import {
  createFormalConversationPipelineState,
  createFormalConversationWorkflowEnv,
  type FormalConversationPipelineInput,
  type RunFormalConversationWorkflowResult,
} from "./formal-conversation/types";
import { registerTransportEventHandler } from "./formal-conversation/transport-event-handler";
import { syncRuntimeTaskElement } from "./formal-conversation/elements/sync-runtime-task.element";
import { exportPromptsElement } from "./formal-conversation/elements/export-prompts.element";
import { transformPromptsToTransportPayloadElement } from "./formal-conversation/elements/transform-prompts-to-transport-payload.element";
import { transformTransportOutputToConversationOutputElement } from "./formal-conversation/elements/transform-transport-output-to-conversation-output.element";
import { handleToolBoundaryElement } from "./formal-conversation/elements/handle-tool-boundary.element";
import { parseIntentRequestsElement } from "./formal-conversation/elements/parse-intent-requests.element";
import { executeIntentRequestsElement } from "./formal-conversation/elements/execute-intent-requests.element";
import { applyIntentRequestExecutionElement } from "./formal-conversation/elements/apply-intent-request-execution.element";
import { finalizeConversationElement } from "./formal-conversation/elements/finalize-conversation.element";

const createFormalConversationPipeline = (
  transport: Transport,
): Pipeline<FormalConversationPipelineInput, RunFormalConversationWorkflowResult> => {
  return {
    name: "FormalConversation",
    elements: [
      syncRuntimeTaskElement,
      exportPromptsElement,
      transformPromptsToTransportPayloadElement,
      createTransportElement(transport),
      transformTransportOutputToConversationOutputElement,
      handleToolBoundaryElement,
      parseIntentRequestsElement,
      executeIntentRequestsElement,
      applyIntentRequestExecutionElement,
      finalizeConversationElement,
    ],
  };
};

export const runFormalConversationWorkflow = async (
  task: TaskItem,
  taskQueue: TaskQueue,
  runtime: Runtime,
  transport: Transport,
) => {
  const env = createFormalConversationWorkflowEnv(task, taskQueue, runtime);
  const state = createFormalConversationPipelineState();
  const eventBus = new PipelineEventBus<PipelineEventMap>();
  const input = { env, state };
  const runner = new PipelineRunner();
  const offTransportEvents = registerTransportEventHandler(eventBus, env, state);

  try {
    return await runner.run(
      createFormalConversationPipeline(transport),
      input,
      {
        task,
        eventBus,
      },
    );
  } finally {
    offTransportEvents();
  }
};
