import type { PipelineContext, PipelineElement } from "@/core/pipeline";
import { TaskState } from "@/types";
import { emitChatOutputUpdatedEvent } from "../helpers/chat-events";
import {
  getToolFailureMessage,
  stringifyToolError,
} from "../helpers/tool-errors";
import type {
  FormalConversationPrompts,
  FormalConversationTransportOutput,
} from "../types";

export const sendConversationElement = {
  name: "formal_conversation.send_conversation",

  async process(
    input: FormalConversationPrompts,
    _context: PipelineContext,
  ): Promise<FormalConversationTransportOutput> {
    let hasSyncedProcessingState = false;
    let hasStreamedVisibleOutput = false;
    let visibleTextBuffer = "";
    let toolCallStartCount = 0;
    let toolCallFinishCount = 0;
    const toolFailureMessages: string[] = [];
    const tools = input.env.runtime.createConversationToolRegistry();

    const transportResult = await input.env.transport.send(
      input.systemPrompt,
      input.userPrompt,
      {
        maxOutputTokens: input.env.runtime.getFormalConversationMaxOutputTokens(),
        maxToolSteps: input.env.runtime.getFormalConversationMaxToolSteps(),
        tools,
        onTextDelta: (textDelta) => {
          if (!hasSyncedProcessingState) {
            input.env.taskQueue.updateTask(
              input.env.task.id,
              { state: TaskState.PROCESSING },
              { shouldSyncEvent: false },
            );
            hasSyncedProcessingState = true;
          }

          input.env.runtime.appendAssistantOutput(textDelta);
          emitChatOutputUpdatedEvent(input.env.task, textDelta);
          hasStreamedVisibleOutput = true;
          visibleTextBuffer += textDelta;
        },
        onToolCallStart: (event) => {
          toolCallStartCount += 1;
          input.env.runtime.reportToolCallStarted(event);
        },
        onToolCallFinish: (event) => {
          toolCallFinishCount += 1;

          if ("error" in event && event.error) {
            toolFailureMessages.push(stringifyToolError(event.error));
          } else {
            const failureMessage = getToolFailureMessage(event.result);

            if (failureMessage) {
              toolFailureMessages.push(failureMessage);
            }
          }

          input.env.runtime.reportToolCallFinished(event);
        },
      },
    );

    input.env.runtime.clearContinuationContext();

    return {
      env: input.env,
      transportResult,
      visibleTextBuffer,
      hasStreamedVisibleOutput,
      toolCallStartCount,
      toolCallFinishCount,
      toolFailureMessages,
    };
  },
} satisfies PipelineElement<
  FormalConversationPrompts,
  FormalConversationTransportOutput
>;
