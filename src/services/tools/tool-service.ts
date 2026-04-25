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
}
