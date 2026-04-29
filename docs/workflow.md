# Workflow

> **版本**: v0.3  
> **更新日期**: 2026-04-29

---

## 概述

Core 的工作流系统围绕 `Queue -> Runtime -> Transport -> Runtime` 主链路设计，三个核心模块各司其职：

- **Queue** — 优先级任务队列，负责任务生命周期推进
- **Runtime** — 运行时上下文与策略编排，组装 prompt、管理 memory、执行 intent request
- **Transport** — 模型通信层，处理流式输出与工具调用

`core.ts` 作为调度者，负责按 workflow 类型分发任务，统一处理错误，以及决定任务结束后的流转。

---

## 三种 Workflow

| Workflow | 职责 | 触发条件 |
|---|---|---|
| `PREDICT_USER_INTENT` | 外部任务入队后，在正式对话前预测用户意图 | 外部任务没有指定 workflow 时默认使用 |
| `FORMAL_CONVERSATION` | 主对话链路，含工具调用、intent request 解析、记忆操作 | 内部任务默认使用 |
| `POST_FOLLOW_UP` | 长对话续接预处理，LLM 摘要生成 continuation 上下文 | 由 intent request 执行结果派生 |

---

## 核心调度

`core.ts` 中 `#workflow()` 方法执行一个完整任务周期：

```
#workflow()
  │
  ├── Queue.activateWorkableTask()     ← 取出下一个可执行任务
  ├── #parseTaskWorkflow()             ← 确定 workflow 类型
  ├── #pickWorkflowRunner()            ← 查找对应的 runner（Map 调度）
  ├── runner()                         ← 执行 workflow
  │     └── toResult()                 ← 捕获异常
  ├── #handleWorkflowError()           ← 统一错误处理
  └── defer_completion 判断           ← 仅 FORMAL_CONVERSATION 返回
       当 decision.type === "defer_completion" 时
       Core 跳过完成流程（不发 CHAT_COMPLETED），
       因为 workflow 已派生续跑任务入队
```

### `#pickWorkflowRunner()`

根据 `TaskWorkflow` 枚举选择对应的 runner 函数，新增 workflow 时在 Map 中添加条目：

```typescript
#pickWorkflowRunner(workflow: TaskWorkflow): WorkflowRunner | undefined {
  const runners = new Map<TaskWorkflow, WorkflowRunner>([
    [TaskWorkflow.PREDICT_USER_INTENT, runUserIntentPredictionWorkflow],
    [TaskWorkflow.POST_FOLLOW_UP, runPostFollowUpWorkflow],
    [TaskWorkflow.FORMAL_CONVERSATION, runFormalConversationWorkflow],
  ]);
  return runners.get(workflow);
}
```

### `#handleWorkflowError()`

所有 workflow 异常统一由此方法处理：记录日志 → 更新任务状态为 `FAILED` → 触发 `CHAT_FAILED` 事件。裸异常（如 `#parseTaskWorkflow` 内部抛错）也能被外层 try/catch 接住。

### `#parseTaskWorkflow()`

1. 优先使用 `task.workflow`
2. 未指定时根据 `task.source` 推断：`EXTERNAL` → `PREDICT_USER_INTENT`，`INTERNAL` → `FORMAL_CONVERSATION`
3. 无法推断时显式抛出错误，拒绝无声 fallback

---

## Workflow 间交接

Workflow 之间不直接调用，通过 Queue 衔接：

```
Workflow A → Runtime 产出内部任务 → Queue → Workflow B
```

例如 `runFormalConversationWorkflow` 在工具调用边界需要续跑时，不自行调用下一轮对话，而是将任务状态推进到 `FOLLOW_UP` 并将新任务入队：

```typescript
// run-formal-conversation.ts
input.env.taskQueue.updateTask(input.env.task.id, { state: TaskState.FOLLOW_UP });
await input.env.taskQueue.addTask(input.env.runtime.buildContinuationFormalConversationTask(input.env.task));
```

Core 在下一轮 `#workflow()` 中会自动从 Queue 取出新任务继续执行。

---

## Intent Request 协议

Intent Request 是 Core 内部通用的工作流请求协议，不只用于正式对话阶段 LLM 输出的请求，也用于意图预测阶段产出的内部请求。

保留来源分类：

| 来源 | 含义 | 示例 |
|---|---|---|
| `prediction` | 来自用户意图预测流程 | 加载记忆、生成正式对话任务 |
| `conversation` | 来自正式对话中 LLM 输出 | SEARCH_MEMORY、FOLLOW_UP、SAVE_MEMORY |

协议统一的好处：

1. workflow 结构统一
2. Runtime 解析入口统一
3. Queue 交接模型统一

---

## 调度者接口

```typescript
class Core {
  async runloop():   // 持续轮询 queue，自动执行任务
  async runOnce():   // 执行一轮任务（测试/受控场景）
  async addTask(task): // 向 queue 添加任务
}
```

`Core` 不持有业务细节（memory、prompt、intent request 解析），只负责：

- 当前任务属于哪条 workflow
- 当前 workflow 结束后是否需要新任务
- 异常如何路由

---

## 相关文件

| 文件 | 职责 |
|---|---|
| `src/core/core.ts` | 调度入口，workflow 分发与错误处理 |
| `src/core/workflows/run-user-intent-prediction.ts` | 用户意图预测 |
| `src/core/workflows/run-formal-conversation.ts` | 正式对话（含工具调用、intent request） |
| `src/core/workflows/run-post-follow-up.ts` | 长对话续接预处理 |
| `src/core/queue/queue.ts` | 优先级队列 |
| `src/core/runtime/runtime.ts` | 运行时服务入口 |
| `src/core/transport/transport.ts` | 模型通信层 |
| `docs/memory-intent-request.md` | Intent Request 与记忆系统关联设计 |
