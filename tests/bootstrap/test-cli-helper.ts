#!/usr/bin/env bun
import { parseArguments } from "@/bootstrap/cli";

// 保存原始函数引用
const originalExit = process.exit;
const originalLog = console.log;

// 存储捕获的数据
let captured: {
  exitCalled: boolean;
  exitCode: number | null;
  logOutput: string[];
} = {
  exitCalled: false,
  exitCode: null,
  logOutput: [],
};

// 重写 process.exit
process.exit = ((code?: number) => {
  captured.exitCalled = true;
  captured.exitCode = code ?? 0;
  // 不真正退出，而是抛出一个特殊错误
  throw { isProcessExit: true, code: captured.exitCode };
}) as typeof process.exit;

// 重写 console.log
console.log = (...args: any[]) => {
  captured.logOutput.push(args.map((arg) => String(arg)).join(" "));
};

let result: any = null;
let error: any = null;

try {
  // 解析参数
  const args = process.argv.slice(2);
  result = parseArguments(args);
} catch (e) {
  // 如果是我们的 process.exit 错误，继续执行
  if (e && typeof e === "object" && "isProcessExit" in e) {
    // 继续执行
  } else {
    error = e;
  }
} finally {
  // 恢复原始函数
  process.exit = originalExit;
  console.log = originalLog;
}

// 输出结果
const output = {
  success: error === null,
  result,
  error: error
    ? error instanceof Error
      ? error.message
      : String(error)
    : null,
  exitCalled: captured.exitCalled,
  exitCode: captured.exitCode,
  logOutput: captured.logOutput,
};

// 使用原始的 console.log 输出结果
originalLog(JSON.stringify(output));
