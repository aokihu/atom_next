import type { ToolSet } from "ai";

/**
 * Tools v1 内置工具名。
 * @description
 * 当前阶段覆盖 milestone 0.12 的全部内置工具，
 * 后续新增工具时先在这里扩展，
 * 再进入 factory 和 registry 层。
 */
export const BUILTIN_TOOL_NAMES = [
  "read",
  "ls",
  "tree",
  "ripgrep",
  "write",
  "cp",
  "mv",
  "bash",
  "git",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

/**
 * 工具预算检查结果。
 * @description
 * ToolService 只负责消费预算并执行拦截，
 * 不负责预算总量、重置时机等更高层策略。
 */
export type ToolBudgetConsumeResult =
  | {
      ok: true;
      used: number;
      remaining: number;
      limit: number;
      toolName: string;
    }
  | {
      ok: false;
      used: number;
      remaining: number;
      limit: number;
      toolName: string;
    };

export type ToolBudgetController = {
  tryConsume: (toolName: string) => ToolBudgetConsumeResult;
};

/**
 * 工具执行完成后的统一事件。
 * @description
 * 未来 Runtime 可以基于这个事件写入工具摘要或统计数据，
 * 当前 ToolService 只负责发射事件，不负责消费。
 */
export type ToolExecutionSettledEvent = {
  toolName: string;
  input: unknown;
  ok: boolean;
  result?: unknown;
  error?: unknown;
};

export type ToolExecutionGuardDecision =
  | {
      allow: true;
    }
  | {
      allow: false;
      reason: string;
    };

export type ToolExecutionGuardEvent = {
  toolName: string;
  input: unknown;
  toolCallId?: string;
};

/**
 * ToolService v1 的最小输出消息结构。
 * @description
 * 当前只保留工具调用和工具结果两类消息，
 * 避免现在就和 TUI 或 Runtime 的完整消息协议耦合。
 */
export type ToolOutputMessage =
  | {
      category: "tool";
      type: "tool.call";
      toolName: string;
      toolCallId?: string;
      inputSummary: string;
    }
  | {
      category: "tool";
      type: "tool.result";
      toolName: string;
      toolCallId?: string;
      ok: boolean;
      outputSummary?: string;
      errorMessage?: string;
    };

export type ToolOutputMessageSink = (message: ToolOutputMessage) => void;

/**
 * 每轮工具执行上下文。
 * @description
 * 这里只保留工具执行真正需要的最小公共字段：
 * - workspace：权限判断根路径
 * - output hook：工具观测
 * - budget / guard / settled：执行控制点
 *
 * 注意这里不放 Runtime / Queue / Task 等对象，
 * 保持 ToolService 独立于 Core 运行时状态。
 */
export type ToolExecutionContext = {
  workspace: string;
  onOutputMessage?: ToolOutputMessageSink;
  toolBudget?: ToolBudgetController;
  beforeToolExecution?: (
    event: ToolExecutionGuardEvent,
  ) => ToolExecutionGuardDecision | Promise<ToolExecutionGuardDecision>;
  onToolExecutionSettled?: (
    event: ToolExecutionSettledEvent,
  ) => void | Promise<void>;
};

export type ToolDefinition = ToolSet[string];

export type ToolDefinitionMap = ToolSet;

/**
 * 工具工厂函数。
 * @description
 * 每个工具都通过 context 惰性构造，
 * 避免在 service 启动时提前绑定某一轮 conversation 的上下文。
 */
export type ToolFactory<TContext extends ToolExecutionContext = ToolExecutionContext> = (
  context: TContext,
) => ToolDefinition;

export class ToolBudgetExceededError extends Error {
  readonly toolName: string;
  readonly used: number;
  readonly remaining: number;
  readonly limit: number;

  constructor(args: { toolName: string; used: number; remaining: number; limit: number }) {
    super(
      `Tool budget exceeded before executing "${args.toolName}" (${args.used}/${args.limit} used)`,
    );
    this.name = "ToolBudgetExceededError";
    this.toolName = args.toolName;
    this.used = args.used;
    this.remaining = args.remaining;
    this.limit = args.limit;
  }
}

export class ToolPolicyBlockedError extends Error {
  readonly toolName: string;

  constructor(args: { toolName: string; reason: string }) {
    super(args.reason);
    this.name = "ToolPolicyBlockedError";
    this.toolName = args.toolName;
  }
}
