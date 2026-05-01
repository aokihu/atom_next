import type { Pipeline } from "@/core/pipeline";
import { exportPromptsElement } from "./elements/export-prompts.element";
import { handleToolBoundaryElement } from "./elements/handle-tool-boundary.element";
import { sendConversationElement } from "./elements/send-conversation.element";
import { syncRuntimeTaskElement } from "./elements/sync-runtime-task.element";
import type {
  FormalConversationWorkflowEnv,
  ToolBoundaryResolution,
} from "./types";

export const formalConversationPrepareAndTransportPipeline = {
  name: "formal_conversation.prepare_and_transport",
  elements: [
    syncRuntimeTaskElement,
    exportPromptsElement,
    sendConversationElement,
    handleToolBoundaryElement,
  ],
} as Pipeline<FormalConversationWorkflowEnv, ToolBoundaryResolution>;
