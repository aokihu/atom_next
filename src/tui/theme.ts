/**
 * TUI Theme
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.1
 * @description 管理 TUI 内置主题、自定义主题 patch 解析和启动阶段的主题回退逻辑。
 */

import { isEmpty, isNullish, isPlainObject, isString } from "radashi";
import nordTheme from "@/assets/themes/nord.json" with { type: "json" };
import oceanTheme from "@/assets/themes/ocean.json" with { type: "json" };
import forestTheme from "@/assets/themes/forest.json" with { type: "json" };
import sunsetTheme from "@/assets/themes/sunset.json" with { type: "json" };
import paperTheme from "@/assets/themes/paper.json" with { type: "json" };

/* -------------------- */
/* Theme Type Helpers   */
/* -------------------- */

/**
 * TUI 目前约定的主题 token 集合。
 * 自定义主题文件只能覆盖这里声明过的颜色项，避免出现任意字段混入。
 */
const TUI_THEME_KEYS = [
  "background",
  "panel",
  "panelMuted",
  "border",
  "text",
  "muted",
  "accent",
  "info",
  "success",
  "warn",
  "danger",
  "user",
] as const;

export type TuiThemeKey = (typeof TUI_THEME_KEYS)[number];

export type TuiThemeScheme = Record<TuiThemeKey, string>;

export type TuiThemePatch = Partial<TuiThemeScheme>;

/**
 * 内置主题名称集合。
 * 配置文件中的 config.theme 可以直接使用这些名字。
 */
export const BUILTIN_TUI_THEME_NAMES = [
  "nord",
  "ocean",
  "forest",
  "sunset",
  "paper",
] as const;

/**
 * 内置主题作为启动兜底基线。
 * 用户自定义主题可以在此基础上只覆盖部分 token。
 */
const builtinTuiThemes: Record<string, TuiThemeScheme> = {
  nord: nordTheme as TuiThemeScheme,
  ocean: oceanTheme as TuiThemeScheme,
  forest: forestTheme as TuiThemeScheme,
  sunset: sunsetTheme as TuiThemeScheme,
  paper: paperTheme as TuiThemeScheme,
};

/* -------------------- */
/* Theme Resolve Types  */
/* -------------------- */

type ResolveTuiThemeOptions = {
  workspace: string;
  theme?: string;
  readThemeFile?: (filePath: string) => Promise<unknown>;
  warn?: (message: string) => void;
};

/**
 * 用户主题文件固定从 workspace/themes 目录读取。
 */
const parseThemeFilePath = (workspace: string, theme: string) => {
  return `${workspace}/themes/${theme}.json`;
};

/**
 * 默认主题文件读取器。
 * 文件不存在时返回 undefined，让上层按回退逻辑继续处理。
 */
const readThemeJsonFile = async (filePath: string) => {
  const file = Bun.file(filePath);
  return !(await file.exists()) ? undefined : await file.json();
};

/**
 * 读取内置主题。
 * 返回结构化拷贝，避免外部误修改内置主题基线。
 */
export const getBuiltinTuiTheme = (
  name: string,
): TuiThemeScheme | undefined => {
  const theme = builtinTuiThemes[name];
  return isNullish(theme) ? undefined : structuredClone(theme);
};

/**
 * 默认主题始终指向 nord，作为所有回退场景的最终兜底。
 */
export const getDefaultTuiTheme = (): TuiThemeScheme => {
  return getBuiltinTuiTheme("nord") as TuiThemeScheme;
};

/**
 * 把用户 JSON 主题解析成 patch。
 * 这里只校验结构和值，不负责决定如何与内置主题合并。
 */
export const parseTuiThemePatch = (raw: unknown): TuiThemePatch => {
  if (!isPlainObject(raw)) {
    throw new Error("Theme file root must be an object");
  }

  const themeConfig = raw as Record<string, unknown>;
  const themePatch: TuiThemePatch = {};

  Object.entries(themeConfig).forEach(([key, value]) => {
    if (!TUI_THEME_KEYS.includes(key as TuiThemeKey)) {
      throw new Error(`Unsupported theme token: ${key}`);
    }

    if (!isString(value) || isEmpty(value.trim())) {
      throw new Error(
        `Invalid theme token ${key}: expected a non-empty string`,
      );
    }

    themePatch[key as TuiThemeKey] = value;
  });

  return themePatch;
};

export const getTuiThemeWithPatch = (
  baseTheme: TuiThemeScheme,
  patch: TuiThemePatch,
): TuiThemeScheme => {
  // 主题合并保持“后者覆盖前者”的简单规则，这样用户主题可以只写自己关心的 token。
  return {
    ...structuredClone(baseTheme),
    ...patch,
  };
};

/**
 * 主题解析顺序：
 * 1. 先按主题名查内置主题
 * 2. 再尝试读取 workspace/themes/<name>.json
 * 3. 用户主题存在时覆盖基线主题
 * 4. 不存在或非法时回退到默认 nord
 */
export const resolveTuiTheme = async ({
  workspace,
  theme,
  readThemeFile = readThemeJsonFile,
  warn = console.warn,
}: ResolveTuiThemeOptions): Promise<TuiThemeScheme> => {
  const selectedTheme =
    isString(theme) && !isEmpty(theme.trim()) ? theme : "nord";
  const builtinTheme = getBuiltinTuiTheme(selectedTheme);
  const baseTheme = builtinTheme ?? getDefaultTuiTheme();
  const themeFilePath = parseThemeFilePath(workspace, selectedTheme);

  try {
    const rawThemePatch = await readThemeFile(themeFilePath);

    if (!isNullish(rawThemePatch)) {
      return getTuiThemeWithPatch(baseTheme, parseTuiThemePatch(rawThemePatch));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    warn(
      `Theme "${selectedTheme}" is invalid, fallback to "nord": ${errorMessage}`,
    );
    return getDefaultTuiTheme();
  }

  if (!isNullish(builtinTheme)) {
    return builtinTheme;
  }

  warn(`Theme "${selectedTheme}" not found, fallback to "nord"`);
  return getDefaultTuiTheme();
};
