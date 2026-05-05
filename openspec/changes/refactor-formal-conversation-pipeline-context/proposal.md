## Why

`formal_conversation` pipeline 目前直接依赖完整 `Runtime` 与 `taskQueue`，导致 pipeline 执行态上下文、系统级 Runtime 状态和本地流式状态混在一起，增加认知负担，也让后续按 pipeline 整理上下文边界变得困难。

## What Changes

- 为 `formal_conversation` 引入显式的 `PipelineContext + PipelineState` 边界
- 将 `formal_conversation` 对完整 `Runtime` 的直接访问收敛为 context 中的显式动作入口
- 保留现有 `PipelineRunner` / `PipelineDefinition` / `Core` 调度方式不变
- 保留旧 `PipelineEnv`，暂不迁移 `post_follow_up` 和 `user_intent_prediction`

**不改变** Core runloop、TaskQueue 主职责、系统级 `Runtime` 命名，也不在本轮删除旧的 pipeline env 结构。

## Impact

- Affected specs: core
- Affected code: `src/core/pipeline/definitions/formal-conversation/*`, `src/core/elements/sync-runtime-task.element.ts`
