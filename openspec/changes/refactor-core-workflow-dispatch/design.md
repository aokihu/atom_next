## Context

Core 作为 workflow 调度者，其 `#workflow()` 方法存在代码重复和扩展性隐患。本次改动只重构 `core.ts` 内部的调度模式，不改变 Core 对外接口或 workflow 实现。

## Goals / Non-Goals

- Goals:
  - 消除三段重复错误处理
  - 用 Map 调度表替代 if/else 硬编码路由
  - 裸异常也能被 try/catch 接住
  - 删除死代码
- Non-Goals:
  - 不改 workflow、queue、runtime、transport
  - 不改测试

## Decisions

### 1. WorkflowRunner 类型

所有 workflow runner 统一签名 `(task, queue, runtime, transport) => Promise<{decision?: {type: "defer_completion"}} | void>`，void 返回的 runner 用 async 包裹。

### 2. Map 调度表

```typescript
static readonly #workflowRunners = new Map<TaskWorkflow, WorkflowRunner>([
  [TaskWorkflow.PREDICT_USER_INTENT, ...],
  [TaskWorkflow.POST_FOLLOW_UP, ...],
  [TaskWorkflow.FORMAL_CONVERSATION, ...],
]);
```

### 3. 单一错误处理器

```typescript
#handleWorkflowError(task: TaskItem, error: unknown, workflow: string): void
```

统一处理：日志 → updateTask FAILED → emit CHAT_FAILED。

### 4. 异常安全

整个 dispatch + toResult 包裹在同一 try/catch 中，`#parseTaskWorkflow` 抛错也能被捕获。

## Risks / Trade-offs

- 无。纯重构，行为不变。

## Migration Plan

改完立即 `bun test` 验证。
