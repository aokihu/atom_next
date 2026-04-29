## 1. Implementation

- [x] 1.1 提取 `#handleWorkflowError()` 方法
- [x] 1.2 建立 `#resolveWorkflowRunner()` 运行时方法（替代静态 Map 以兼容 mock）
- [x] 1.3 重构 `#workflow()` 使用方法调度 + 统一 try/catch
- [x] 1.4 修复 `#parseTaskWorkflow` 隐式 fallback → 改为显式 throw
- [x] 1.5 删除 `#activeTimer` 死代码
- [x] 1.6 运行 `bun test` 验证（12 core 测试全部通过，其余失败为前置已有）
