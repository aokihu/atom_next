/**
 * context-manager/state.ts
 * @description
 * 提供 ContextManager 子域的基础状态工厂。
 *
 * 这个文件只负责创建“空白初始状态”，不参与 task 同步、
 * memory 状态迁移或其他业务判断。它的作用是把默认状态定义集中收口，
 * 让 ContextManager 本体只关心“什么时候应用状态”，而不是“状态长什么样”。
 */
import type {
  RuntimeConversationContext,
  RuntimeFollowUpContext,
  RuntimeMemoryContext,
  RuntimeMemoryScopeContext,
  RuntimeSessionContext,
} from "./types";

/* ==================== */
/* Base State Factory   */
/* ==================== */

export const createRuntimeFollowUpContext = (): RuntimeFollowUpContext => {
  return {
    chatId: "",
    chainRound: null,
    originalUserInput: "",
    accumulatedAssistantOutput: "",
    lastAssistantOutput: "",
  };
};

/* ==================== */
/* Nested State Factory */
/* ==================== */

export const createRuntimeMemoryScopeContext = (): RuntimeMemoryScopeContext => {
  return {
    status: "idle",
    query: "",
    reason: "",
    outputs: [],
    updatedAt: null,
  };
};

export const createRuntimeMemoryContext = (): RuntimeMemoryContext => {
  return {
    core: createRuntimeMemoryScopeContext(),
    short: createRuntimeMemoryScopeContext(),
    long: createRuntimeMemoryScopeContext(),
  };
};

export const createRuntimeConversationContext =
  (): RuntimeConversationContext => {
    return {
      lastUserInput: "",
      lastAssistantOutput: "",
      updatedAt: null,
    };
  };

export const createRuntimeSessionContext = (): RuntimeSessionContext => {
  return {
    memory: createRuntimeMemoryContext(),
    conversation: createRuntimeConversationContext(),
  };
};
