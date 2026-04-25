import type { ToolDefinitionMap, ToolExecutionContext } from "../types";
import { createBuiltinToolRegistry } from "./factories";
import { wrapToolRegistryWithOutput } from "./output-wrapper";

export { createBuiltinToolRegistry } from "./factories";

type CreateToolRegistryOptions = {
  context: ToolExecutionContext;
  additionalTools?: ToolDefinitionMap;
};

/**
 * 创建当前轮工具 registry。
 * @description
 * v1 默认只拼 builtin tools，但保留 `additionalTools` 扩展口，
 * 方便未来接 Runtime 注入的动态工具或其他来源工具。
 */
export const createToolRegistry = ({
  context,
  additionalTools = {},
}: CreateToolRegistryOptions): ToolDefinitionMap => {
  const builtinTools = createBuiltinToolRegistry(context);

  // 工具名冲突直接中断，避免后续出现“模型调的是 read，实际执行的是别的 read”。
  for (const toolName of Object.keys(additionalTools)) {
    if (toolName in builtinTools) {
      throw new Error(`Tool name conflict: ${toolName}`);
    }
  }

  return wrapToolRegistryWithOutput(
    {
      ...builtinTools,
      ...additionalTools,
    },
    context,
  );
};
