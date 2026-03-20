/**
 * 存放一些方便的自制工具函数
 */

type MaybeGetter<T> = T | (() => T);

export function withDefault<T>(
  value: MaybeGetter<T | null | undefined>,
  defaultValue: MaybeGetter<T>,
): T {
  const resolved =
    typeof value === "function"
      ? (value as () => T | null | undefined)()
      : value;

  if (resolved !== null && resolved !== undefined) {
    return resolved;
  }

  return typeof defaultValue === "function"
    ? (defaultValue as () => T)()
    : defaultValue;
}
