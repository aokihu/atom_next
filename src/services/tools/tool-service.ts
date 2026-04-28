import { isAbsolute } from "node:path";
import { BaseService } from "@/services/base";
import { createToolRegistry } from "./registry";
import type {
  ToolDefinitionMap,
  ToolExecutionContext,
} from "./types";

type CreateExecutionContextInput = Omit<ToolExecutionContext, "workspace"> & {
  workspace?: string;
};

type CreateToolRegistryInput = {
  context: ToolExecutionContext;
  additionalTools?: ToolDefinitionMap;
};

const stripToolExecute = (registry: ToolDefinitionMap): ToolDefinitionMap => {
  const protocolRegistry: ToolDefinitionMap = {};

  for (const [toolName, definition] of Object.entries(registry)) {
    const { execute: _execute, ...rest } =
      definition as Record<string, unknown> & { execute?: unknown };
    protocolRegistry[toolName] = rest as ToolDefinitionMap[string];
  }

  return protocolRegistry;
};

/**
 * ToolService。
 * @description
 * v1 只负责工具服务边界本身：
 * - 构造执行上下文
 * - 构造工具 registry
 *
 * 它不负责 Runtime 编排、不负责 Transport 接线，也不持有 task 状态。
 */
export class ToolService extends BaseService {
  constructor() {
    super();
    this._name = "tools";
  }

  /**
   * v1 无需启动逻辑。
   */
  override async start() {}

  /**
   * 创建当前轮工具执行上下文。
   * @description
   * workspace 由调用方显式传入，避免 ToolService 反向依赖 RuntimeService。
   */
  public createExecutionContext(input: CreateExecutionContextInput): ToolExecutionContext {
    const workspace = input.workspace?.trim() ?? "";

    if (workspace === "") {
      throw new Error("Tool execution workspace is required");
    }

    if (!isAbsolute(workspace)) {
      throw new Error("Tool execution workspace must be an absolute path");
    }

    return {
      workspace,
      ...(input.onOutputMessage ? { onOutputMessage: input.onOutputMessage } : {}),
      ...(input.toolBudget ? { toolBudget: input.toolBudget } : {}),
      ...(input.beforeToolExecution
        ? { beforeToolExecution: input.beforeToolExecution }
        : {}),
      ...(input.onToolExecutionSettled
        ? { onToolExecutionSettled: input.onToolExecutionSettled }
        : {}),
    };
  }

  /**
   * 创建当前轮可用工具 registry。
   */
  public createToolRegistry(input: CreateToolRegistryInput) {
    return createToolRegistry({
      context: input.context,
      additionalTools: input.additionalTools,
    });
  }

  /**
   * 创建只用于模型协议描述的工具 registry。
   * @description
   * 保留 ai-sdk tool schema，但移除 execute，
   * 让 Runtime 接管真实执行与续跑。
   */
  public createToolProtocolRegistry(input: CreateToolRegistryInput) {
    return stripToolExecute(this.createToolRegistry(input));
  }

  /**
   * 执行单次工具调用。
   * @description
   * Runtime 通过这个高层入口执行工具，
   * 避免直接依赖 registry 的内部结构。
   */
  public async executeTool(input: CreateToolRegistryInput & {
    toolName: string;
    toolInput: unknown;
    toolCallId?: string;
  }) {
    const registry = this.createToolRegistry(input);
    const definition = registry[input.toolName];

    if (!definition) {
      throw new Error(`Tool not found: ${input.toolName}`);
    }

    const execute = (definition as { execute?: unknown }).execute;

    if (typeof execute !== "function") {
      throw new Error(`Tool execute is unavailable: ${input.toolName}`);
    }

    return await execute.call(definition, input.toolInput, {
      toolCallId: input.toolCallId,
    });
  }
}
