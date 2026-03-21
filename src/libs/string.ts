/**
 * 将驼峰命名转换为下划线命名
 * @param str 驼峰命名字符串
 * @returns 下划线命名字符串
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}
