import {
  type ToolDefinitionMap,
  type ToolExecutionContext,
  ToolBudgetExceededError,
  ToolPolicyBlockedError,
} from "../types";

/**
 * 从 AI SDK 工具执行参数中提取 toolCallId。
 * @description
 * 当前 metadata 结构由 AI SDK 决定，这里单独收口，
 * 避免每个工具包装逻辑都重复读取第二个参数。
 */
const getToolCallId = (args: unknown[]): string | undefined => {
  const metadata = args[1];

  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const value = (metadata as Record<string, unknown>).toolCallId;
  return typeof value === "string" ? value : undefined;
};

/**
 * 生成轻量输出摘要，用于工具观测消息。
 */
const summarizeOutputValue = (value: unknown, maxLength = 320): string => {
  let serialized = "";

  if (typeof value === "string") {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(value) ?? String(value);
    } catch {
      serialized = String(value);
    }
  }

  const normalized = serialized.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  if (maxLength <= 3) {
    return normalized.slice(0, maxLength);
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const toOutputErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 从工具返回值中提取语义错误。
 * @description
 * v1 工具统一使用 `{ error: string }` 表示可预期失败；
 * 这类失败不走 throw，但仍要在 settled 和 output message 里标记为失败。
 */
const getToolErrorMessageFromOutput = (result: unknown) => {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }

  const errorValue = (result as Record<string, unknown>).error;

  return typeof errorValue === "string" && errorValue.trim() !== ""
    ? errorValue
    : undefined;
};

/**
 * 发射工具输出消息。
 * @description
 * 观测 hook 绝不能影响真实工具执行，因此这里吞掉 sink 自身异常。
 */
const emitOutputMessage = (
  sink: ToolExecutionContext["onOutputMessage"],
  message: Parameters<NonNullable<ToolExecutionContext["onOutputMessage"]>>[0],
) => {
  if (!sink) {
    return;
  }

  try {
    sink(message);
  } catch {
    // Observability hooks must not break tool execution.
  }
};

/**
 * 给单个工具定义包一层统一执行包装。
 * @description
 * 所有工具在这里统一接入：
 * - budget
 * - guard
 * - output message
 * - settled hook
 */
const wrapToolDefinition = (
  toolName: string,
  definition: ToolDefinitionMap[string],
  context: ToolExecutionContext,
): ToolDefinitionMap[string] => {
  const execute = (definition as { execute?: unknown }).execute;

  if (typeof execute !== "function") {
    return definition;
  }

  return {
    ...(definition as Record<string, unknown>),
    execute: async (...args: unknown[]) => {
      const toolCallId = getToolCallId(args);
      const input = args[0];

      const emitSettled = async (event: {
        ok: boolean;
        result?: unknown;
        error?: unknown;
      }) => {
        try {
          await context.onToolExecutionSettled?.({
            toolName,
            input,
            ok: event.ok,
            result: event.result,
            error: event.error,
          });
        } catch {
          // Context sync hooks must not break tool execution.
        }
      };

      // budget 在真正执行前消费，保证超限时不会进入工具逻辑。
      const budgetResult = context.toolBudget?.tryConsume(toolName);

      if (budgetResult && !budgetResult.ok) {
        throw new ToolBudgetExceededError({
          toolName,
          used: budgetResult.used,
          remaining: budgetResult.remaining,
          limit: budgetResult.limit,
        });
      }

      emitOutputMessage(context.onOutputMessage, {
        category: "tool",
        type: "tool.call",
        toolName,
        toolCallId,
        inputSummary: summarizeOutputValue(input),
      });

      // guard 负责策略阻断，例如未来高风险工具审批。
      const guardDecision = await context.beforeToolExecution?.({
        toolName,
        input,
        toolCallId,
      });

      if (guardDecision && !guardDecision.allow) {
        await emitSettled({
          ok: false,
          error: guardDecision.reason,
        });

        emitOutputMessage(context.onOutputMessage, {
          category: "tool",
          type: "tool.result",
          toolName,
          toolCallId,
          ok: false,
          errorMessage: guardDecision.reason,
        });

        throw new ToolPolicyBlockedError({
          toolName,
          reason: guardDecision.reason,
        });
      }

      try {
        const result = await execute.apply(definition, args);
        const errorMessage = getToolErrorMessageFromOutput(result);

        // 工具返回 `{ error }` 也算 settled，只是 ok=false。
        await emitSettled({
          ok: errorMessage === undefined,
          result,
          ...(errorMessage ? { error: errorMessage } : {}),
        });

        emitOutputMessage(context.onOutputMessage, {
          category: "tool",
          type: "tool.result",
          toolName,
          toolCallId,
          ok: errorMessage === undefined,
          ...(errorMessage
            ? { errorMessage }
            : { outputSummary: summarizeOutputValue(result) }),
        });

        return result;
      } catch (error) {
        await emitSettled({
          ok: false,
          error,
        });

        emitOutputMessage(context.onOutputMessage, {
          category: "tool",
          type: "tool.result",
          toolName,
          toolCallId,
          ok: false,
          errorMessage: toOutputErrorMessage(error),
        });

        throw error;
      }
    },
  } as ToolDefinitionMap[string];
};

/**
 * 给整个 registry 统一包执行包装。
 */
export const wrapToolRegistryWithOutput = (
  registry: ToolDefinitionMap,
  context: ToolExecutionContext,
): ToolDefinitionMap => {
  if (
    !context.onOutputMessage
    && !context.toolBudget
    && !context.onToolExecutionSettled
    && !context.beforeToolExecution
  ) {
    return registry;
  }

  const wrapped: ToolDefinitionMap = {};

  for (const [toolName, definition] of Object.entries(registry)) {
    wrapped[toolName] = wrapToolDefinition(toolName, definition, context);
  }

  return wrapped;
};
