## 1. Implementation

- [x] 1.1 为 `formal_conversation` 新增专用 `PipelineContext`
- [x] 1.2 保留 `PipelineState`，将 `FormalConversationPipelineInput` 从 `{ env, state }` 改为 `{ context, state }`
- [x] 1.3 迁移 `formal_conversation` element 链与 transport event handler 使用 `context`
- [x] 1.4 让 `sync-runtime-task.element` 同时兼容新 `context` 形状和旧 `env` 形状
- [x] 1.5 运行 OpenSpec 校验与 TypeScript 类型检查
