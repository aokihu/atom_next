## Why

`src/core/core.ts` 中存在三处重复的错误处理代码、硬编码的 if/else workflow 路由、死代码和隐式 fallback 逻辑，降低了可维护性和扩展性。当新增 workflow 类型时必须修改 `#workflow()` 方法，违反开闭原则。

## What Changes

- 将三段重复的错误处理代码（L103-134 / L147-176 / L190-220）合并为 `#handleWorkflowError()` 单一方法
- 将三个 if/else 分支替换为 `WORKFLOW_RUNNERS` Map 调度表，新增 workflow 时只需注册 runner
- 统一 try/catch 保护，裸异常也能被接住
- 修复 `#parseTaskWorkflow` 的隐式 fallback，显式 throw 未知来源
- 删除未使用的 `#activeTimer` 字段

**不改变** 任何 workflow 函数签名、queue/runtime/transport 接口、测试文件。

## Impact

- Affected specs: core (新增)
- Affected code: `src/core/core.ts` 仅此一个文件
