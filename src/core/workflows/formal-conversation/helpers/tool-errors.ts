export const getToolFailureMessage = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const errorValue = (value as Record<string, unknown>).error;
  return typeof errorValue === "string" && errorValue.trim() !== ""
    ? errorValue.trim()
    : undefined;
};

export const stringifyToolError = (value: unknown) => {
  if (value instanceof Error) {
    return value.message;
  }

  return String(value);
};

export const buildToolFailureVisibleMessage = (messages: string[]) => {
  const [firstMessage] = messages;
  return firstMessage
    ? `工具调用失败，暂时无法继续分析当前工作区。错误：${firstMessage}`
    : "工具调用失败，暂时无法继续分析当前工作区。";
};
