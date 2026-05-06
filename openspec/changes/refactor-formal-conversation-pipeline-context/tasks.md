## 1. Implementation

- [x] 1.1 为 `formal_conversation` 新增专用 `PipelineContext`
- [x] 1.2 保留 `FormalConversationPipelineState`，将其输入从 `{ env, state }` 改为 `{ context, state }`
- [x] 1.3 迁移 `formal_conversation` element 链与 transport event handler 使用 `context`
- [x] 1.4 为 `post_follow_up` 和 `user_intent_prediction` 新增各自的 `PipelineContext`
- [x] 1.5 为另外两条 pipeline 补最小 `PipelineState`，并迁移输入与 finalize 流转到 `{ context, state }`
- [x] 1.6 让 `sync-runtime-task.element` 只依赖 context 中的 `syncCurrentTask()`
- [x] 1.7 运行 OpenSpec 校验与测试/类型验证
