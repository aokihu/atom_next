/**
 * prompt/system-rules.ts
 * @description
 * 负责读取 Runtime 使用的系统规则文本资源。
 *
 * 这个文件只处理“系统规则文件 -> 文本内容”的读取逻辑，
 * 不负责保存 Runtime 当前状态，也不负责最终 prompt 组装。
 * 这样 prompt 资源读取可以独立演进，不继续堆在 runtime.ts 主入口里。
 */

/* ==================== */
/* System Rules         */
/* ==================== */

/**
 * 从文件中读取系统规则文本。
 * @description
 * 文件不存在时抛错，由调用方决定如何处理 Runtime 当前状态。
 */
export async function loadSystemRules(file: string): Promise<string> {
  if (!(await Bun.file(file).exists())) {
    throw new Error(`System rules file not found: ${file}`);
  }

  return Bun.file(file).text();
}
