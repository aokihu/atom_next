import type { ToolDefinitionMap } from "@/services/tools";
import { TaskState, type TaskItem } from "@/types/task";
import type { Runtime } from "@/core/runtime";
import type { TaskQueue } from "@/core/queue";

export type FormalConversationPipelineContext = {
  task: TaskItem;
  transport: {
    maxOutputTokens: number | undefined;
    maxToolSteps: number | undefined;
    tools: ToolDefinitionMap | null;
  };
  syncCurrentTask: () => void;
  markTaskProcessing: () => void;
  exportPrompts: () => Promise<[string, string]>;
  clearContinuationContext: () => void;
  parseIntentRequest: Runtime["parseIntentRequest"];
  executeIntentRequests: (
    requests: Parameters<Runtime["executeIntentRequests"]>[1],
  ) => ReturnType<Runtime["executeIntentRequests"]>;
  finalizeChatTurn: (
    options: Parameters<Runtime["finalizeChatTurn"]>[1],
  ) => ReturnType<Runtime["finalizeChatTurn"]>;
  createContinuationFormalConversationTask: () => ReturnType<
    Runtime["createContinuationFormalConversationTask"]
  >;
  createLengthLimitedPostFollowUpTask: () => ReturnType<
    Runtime["createLengthLimitedPostFollowUpTask"]
  >;
  createConversationToolRegistry: () => ToolDefinitionMap;
  executeConversationToolCalls: (
    toolCalls: Parameters<Runtime["executeConversationToolCalls"]>[0],
  ) => ReturnType<Runtime["executeConversationToolCalls"]>;
  appendAssistantOutput: Runtime["appendAssistantOutput"];
  reportToolCallStarted: Runtime["reportToolCallStarted"];
  reportToolCallFinished: Runtime["reportToolCallFinished"];
  reportConversationOutputAnalysis: Runtime["reportConversationOutputAnalysis"];
};

export const createFormalConversationPipelineContext = (
  task: TaskItem,
  deps: {
    runtime: Runtime;
    taskQueue: TaskQueue;
  },
): FormalConversationPipelineContext => {
  const transport = {
    maxOutputTokens: deps.runtime.getFormalConversationMaxOutputTokens(),
    maxToolSteps: deps.runtime.getFormalConversationMaxToolSteps(),
    tools: null as ToolDefinitionMap | null,
  };

  const syncCurrentTask = () => {
    deps.runtime.currentTask = task;

    if (!transport.tools) {
      transport.tools = deps.runtime.createConversationToolRegistry();
    }
  };

  return {
    task,
    transport,
    syncCurrentTask,
    markTaskProcessing: () => {
      deps.taskQueue.updateTask(
        task.id,
        { state: TaskState.PROCESSING },
        { shouldSyncEvent: false },
      );
    },
    exportPrompts: () => deps.runtime.exportPrompts(),
    clearContinuationContext: () => deps.runtime.clearContinuationContext(),
    parseIntentRequest: (intentRequestText) => {
      return deps.runtime.parseIntentRequest(intentRequestText);
    },
    executeIntentRequests: (requests) => {
      return deps.runtime.executeIntentRequests(task, requests);
    },
    finalizeChatTurn: (options) => {
      return deps.runtime.finalizeChatTurn(task, options);
    },
    createContinuationFormalConversationTask: () => {
      return deps.runtime.createContinuationFormalConversationTask(task);
    },
    createLengthLimitedPostFollowUpTask: () => {
      return deps.runtime.createLengthLimitedPostFollowUpTask(task);
    },
    createConversationToolRegistry: () => {
      syncCurrentTask();
      if (!transport.tools) {
        transport.tools = deps.runtime.createConversationToolRegistry();
      }

      return transport.tools;
    },
    executeConversationToolCalls: (toolCalls) => {
      return deps.runtime.executeConversationToolCalls(toolCalls);
    },
    appendAssistantOutput: (textDelta) => {
      deps.runtime.appendAssistantOutput(textDelta);
    },
    reportToolCallStarted: (input) => {
      deps.runtime.reportToolCallStarted(input);
    },
    reportToolCallFinished: (input) => {
      deps.runtime.reportToolCallFinished(input);
    },
    reportConversationOutputAnalysis: (input) => {
      deps.runtime.reportConversationOutputAnalysis(input);
    },
  };
};
