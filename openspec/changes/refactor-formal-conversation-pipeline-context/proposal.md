## Why

三条 pipeline 目前都直接依赖完整 `Runtime`，导致 pipeline 执行态上下文、系统级 Runtime 状态和本地状态混在一起，增加认知负担，也让后续整理 Core Runtime 边界变得困难。

## What Changes

- 为三条 pipeline 全部引入显式的 `PipelineContext + PipelineState` 边界
- 将三条 pipeline 对完整 `Runtime` 的直接访问收敛为 context 中的显式动作入口
- 保留现有 `PipelineRunner` / `PipelineDefinition` / `Core` 调度方式不变
- 让 `sync-runtime-task.element` 只依赖 context 中的显式 task 同步动作

**不改变** Core runloop、TaskQueue 主职责、系统级 `Runtime` 命名，也不在本轮直接整理 Core Runtime 内部数据结构。

## Impact

- Affected specs: core
- Affected code: `src/core/pipeline/definitions/*`, `src/core/elements/sync-runtime-task.element.ts`
