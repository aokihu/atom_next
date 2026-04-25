import {
  bashTool,
  cpTool,
  gitTool,
  lsTool,
  mvTool,
  readTool,
  ripgrepTool,
  treeTool,
  writeTool,
} from "../builtin";
import {
  BUILTIN_TOOL_NAMES,
  type BuiltinToolName,
  type ToolDefinitionMap,
  type ToolExecutionContext,
  type ToolFactory,
} from "../types";

/**
 * 内置工具工厂映射。
 * @description
 * registry 构造时统一从这里取，避免工具名与实现分散在多个文件里。
 */
const BUILTIN_TOOL_FACTORIES: Record<BuiltinToolName, ToolFactory> = {
  read: readTool,
  ls: lsTool,
  tree: treeTool,
  ripgrep: ripgrepTool,
  write: writeTool,
  cp: cpTool,
  mv: mvTool,
  bash: bashTool,
  git: gitTool,
};

/**
 * 基于当前执行上下文创建内置工具 registry。
 */
export const createBuiltinToolRegistry = (context: ToolExecutionContext): ToolDefinitionMap => {
  const registry: ToolDefinitionMap = {};

  for (const toolName of BUILTIN_TOOL_NAMES) {
    registry[toolName] = BUILTIN_TOOL_FACTORIES[toolName](context);
  }

  return registry;
};
