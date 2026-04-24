import type { LogEntry, LogLevel } from "../types";

type PrettyLogOptions = {
  color?: boolean;
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: Bun.color("#e6e6e6", "ansi-256") as string,
  info: Bun.color("#1c9611", "ansi-256") as string,
  warn: Bun.color("#d2c618", "ansi-256") as string,
  error: Bun.color("#cb0c35", "ansi-256") as string,
};

const COLOR_RESET = "\u001b[0m";

/**
 * 给文本上色
 * @param text 输出文本
 * @param color 输出颜色,使用Bun.color设置
 * @returns 带色彩的文本
 */
const colorizeText = (text: string, color: string): string =>
  `${color}${text}${COLOR_RESET}`;

const formatLogValue = (value: unknown) => {
  if (typeof value === "string") {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }

  return JSON.stringify(value);
};

const formatLogData = (data: unknown) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return data === undefined ? [] : [`data=${formatLogValue(data)}`];
  }

  return Object.entries(data).map(([key, value]) => {
    return `${key}=${formatLogValue(value)}`;
  });
};

const colorizeLevel = (level: LogLevel, text: string, color: boolean) => {
  return color ? `${LEVEL_COLORS[level]}${text}${COLOR_RESET}` : text;
};

export const formatPrettyLogEntry = (
  entry: LogEntry,
  options: PrettyLogOptions = {},
) => {
  const level = entry.level.toUpperCase();
  const source = entry.source;
  const context = [
    ...formatLogData(entry.data),
    ...(entry.error ? [`error=${formatLogValue(entry.error.message)}`] : []),
  ];
  const suffix = context.length > 0 ? ` ${context.join(" ")}` : "";

  return [
    colorizeLevel(entry.level, `[${level}]`, options.color === true),
    colorizeText(source, Bun.color("rgb(180,180,180", "ansi-256") as string),
    `${entry.message}${suffix}`,
  ].join(" ");
};
