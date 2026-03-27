/**
 * 错误工具模块
 * @description 提供统一的错误构造和错误原因常量
 */

export enum ErrorCause {
  BadRequest = "bad-request",
  NotFound = "not-found",
  Config = "config-error",
  InvalidState = "invalid-state",
}

type BuildErrorOptions = {
  cause?: ErrorCause | string;
};

export const buildError = (message: string, options: BuildErrorOptions = {}) =>
  new Error(message, options.cause ? { cause: options.cause } : undefined);

export const hasErrorCause = (
  error: unknown,
  cause: ErrorCause | string,
): error is Error => error instanceof Error && error.cause === cause;
