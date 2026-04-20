# PLAN 0.10 Core Restruct

## 文档目的

本文件用于记录 `0.10` 阶段内 `Core` 的渐进式重构计划。  
目标不是一次性重写 `Core`，而是在不破坏现有能力的前提下，逐步将结构收口到更清晰的职责边界。

本计划遵循以下原则:

- 每一步都必须是可验证的最小重构
- 每一步都要经过 “重构 -> 验证 -> 通过 -> 下一步重构”
- 不把结构重构和新业务扩张混在一起
- 不在 `0.10` 中提前实现 `0.11` 的 memory lifecycle 复杂策略

---

## Core 概念前提

`Core` 是抽象概念，不是单一类。

当前项目中，`Core` 由以下三个模块共同组成:

- `Queue`
- `Runtime`
- `Transport`

默认协作主链为:

```text
Queue -> Runtime -> Transport -> Runtime
```

其中:

- `Queue` 负责任务推进
- `Runtime` 负责上下文准备、策略分配、结果接收与后续编排
- `Transport` 负责模型调用

`Runtime` 是 `Core` 内主要的调度和分配模块。

---

## 当前问题判断

### 当前已经比较清晰的部分

- `Transport` 目前主要负责模型调用，职责相对聚焦
- `Queue` 目前主要负责任务推进和状态事件，职责相对聚焦
- `Runtime` 已经具备 session/chat 上下文、memory context、prompt export 的基础能力

### 当前主要问题

当前最重的结构负担集中在:

- [src/core/core.ts](/Volumes/Projects/atom_next/src/core/core.ts)
- [src/core/runtime/runtime.ts](/Volumes/Projects/atom_next/src/core/runtime/runtime.ts)

具体表现为:

- `core.ts` 仍然承担了过多编排细节
- `Runtime` 仍然同时承担 store + prompt builder + manager gateway
- 用户输入意图预测链路已经抽出 manager，但调用入口仍然散在 `core.ts`
- memory request 执行链路仍然大量停留在 `core.ts`
- 最终结果收束与 session continuity 回写逻辑仍主要停留在 `core.ts`

因此当前真实调用链更接近:

```text
Queue -> core.ts coordinator -> Runtime -> Transport -> core.ts -> Runtime
```

这和目标主链不一致。

另外需要明确:

- `core.ts` 不应被理解成“只做抽象转发的空壳文件”
- `core.ts` 可以保留为函数式编排层
- 但不应继续堆积大量状态细节和底层业务执行细节

后续重构目标不是把 `core.ts` 清空，而是让它更清晰地表达两条主流程:

1. 用户输入预处理流程
2. 正式对话执行流程

---

## 重构边界

### 本次要做

- 逐步收紧 `Runtime` 作为 `Core` 主调度模块的地位
- 逐步减轻 `core.ts` 中的编排逻辑
- 逐步把纯逻辑与状态逻辑拆到更合理的位置
- 每一步都保留现有测试和手工验证入口

### 本次不做

- 不重写 HTTP API
- 不重写 `Queue`
- 不重写 `Transport`
- 不在这一轮处理 session memory 生命周期策略
- 不在这一轮处理 topic boundary 检测
- 不把所有 memory 行为一次性统一重写

---

## 总体实施原则

每一步都必须遵守以下流程:

1. 先限定单一步骤的重构边界
2. 只移动职责，不追加无关新功能
3. 先跑自动化测试
4. 再做最小手工验证
5. 通过后再进入下一步

如果某一步没有通过验证，则停止进入下一步，优先修正当前步骤。

同时补充一条结构原则:

- `core.ts` 作为流程编排层保留
- `Runtime` 负责状态、上下文、策略与结果分配
- `Transport` 负责模型调用
- `Queue` 负责任务推进
- 纯逻辑优先函数化，不继续把可复用逻辑塞进大对象方法中

---

## Core 编排目标

后续 `core.ts` 以函数式编排方式表达主链，不追求“极薄空壳”，而是追求“流程清晰”。

目标形态应逐步收敛为两条主流程:

### 1. 用户输入预处理流程

用于在正式回答前完成:

- 用户输入意图预测
- prediction fallback
- intent policy resolve
- memory preload
- 执行前上下文准备

### 2. 正式对话执行流程

用于完成:

- prompt 导出
- transport.send
- 流式输出接收
- intent request 解析与处理
- follow-up / complete 收束

理想上，`core.ts` 中的结构应逐步接近:

```text
runTask(task)
-> prepareUserInputFlow(task)
-> runConversationFlow(task)
```

这里的“函数式”含义是:

- 流程按步骤拆成少量清晰函数
- 每个步骤负责单一阶段
- 不通过层层对象互调来表达编排关系

---

## 阶段1: 收口用户输入预处理链路

### 目标

把用户输入预处理链路收敛为 `core.ts` 中一条清晰的函数式流程:

```text
predict intent
-> parse predicted intent
-> fallback predicted intent
-> resolve intent policy
-> preload memory from policy
```

### 当前问题

当前这些步骤虽然逻辑上属于 `Runtime` 主调度范围，但仍然在 [src/core/core.ts](/Volumes/Projects/atom_next/src/core/core.ts) 中分散存在:

- `#predictIntentIfNeeded()`
- `#resolveIntentPolicyIfNeeded()`
- `#hydrateMemoryFromPolicy()`

### 重构内容

在 `core.ts` 中形成明确的预处理流程函数，例如:

- `prepareUserInputFlow(task)`

同时将底层状态与执行细节继续收口给 `Runtime`，例如由 `Runtime` 提供单入口:

- `prepareExecutionContext(task, transport)`

整体效果应是:

- `core.ts` 负责按顺序组织预处理步骤
- `Runtime` 负责真正执行上下文准备

预处理流程内部负责:

- 调用 `Transport.predictIntent`
- 解析 prediction 输出
- 写入 fallback predicted intent
- 解析 intent policy
- 根据 policy 预加载 memory

`core.ts` 不再持有这些实现细节的散乱版本，而是保留单个函数式入口。

### 验证

自动化测试至少包括:

- intent prediction 成功时，memory preload 不回归
- intent prediction 失败时，主回答仍然继续
- 低置信度 policy 不会错误 preload

手工验证至少包括:

- 显式记忆问题仍能自动预加载记忆
- 意图预测失败时，聊天仍能正常回答

### 通过标准

- `core.ts` 中形成单一的预处理流程入口
- 所有现有相关测试通过
- TUI 手工验证不回归

### 下一步

进入阶段2。

---

## 阶段2: 收口 Intent Request 执行链路

### 目标

把正式对话执行流程中的 `Intent Request` 处理部分收敛为清晰步骤。

### 当前问题

当前 [src/core/core.ts](/Volumes/Projects/atom_next/src/core/core.ts) 仍直接处理大量 request 分支:

- `SEARCH_MEMORY`
- `LOAD_MEMORY`
- `SAVE_MEMORY`
- `UPDATE_MEMORY`
- `UNLOAD_MEMORY`
- `FOLLOW_UP`

这导致 `core.ts` 既像协调器，又像 memory application service。

### 重构内容

优先把正式对话流程中的 memory request 执行整理成单一编排步骤:

- `SEARCH_MEMORY`
- `LOAD_MEMORY`
- `SAVE_MEMORY`
- `UPDATE_MEMORY`
- `UNLOAD_MEMORY`

建议在 `Runtime` 提供单入口或成组入口，例如:

- `applyMemoryIntentRequest(...)`
- `applyIntentRequests(...)`

原则:

- `core.ts` 保留“正式对话执行流程”中的 request 处理步骤
- `Runtime` 负责“request 如何更新 memory context 与 session/chat 状态”
- `core.ts` 不再直接散落多个 memory handler 细节实现

`FOLLOW_UP` 相关派生任务可以暂时保留在 `core.ts`，后续再评估是否继续下沉。

### 验证

自动化测试至少包括:

- search + follow up 不回归
- load / update / unload 不回归
- save 后 memory context 正常刷新
- repeated search closure 不回归

手工验证至少包括:

- 先搜索再回答
- 显式 load memory
- save 后下一轮能继续读到结果

### 通过标准

- `core.ts` 中 request 处理成为清晰的流程步骤，而不是散落的细节集合
- `Runtime` 成为 memory request 执行后的上下文归口层

### 下一步

进入阶段3。

---

## 阶段3: 整理 Runtime 内部状态边界

### 目标

在不改行为的前提下，把 `Runtime` 从“大对象 + 多块状态”整理成“主调度类 + 更清晰的状态变换模块”。

### 当前问题

当前 [src/core/runtime/runtime.ts](/Volumes/Projects/atom_next/src/core/runtime/runtime.ts) 仍然较大，同时承担:

- session conversation
- follow-up
- memory state
- prompt export
- task rounds
- manager gateway

### 重构内容

只抽纯逻辑或可复用状态变换，不盲目拆文件。

优先考虑收口为:

- conversation state helpers
- follow-up state helpers
- memory state helpers
- prompt export helpers

原则:

- 状态相关职责继续保留在对象里
- 无状态逻辑优先抽为函数
- 不增加多层对象互调

### 验证

自动化测试至少包括:

- runtime 测试全过
- prompt 输出不回归
- session continuity / memory context 不回归

手工验证至少包括:

- 普通问答
- 连续对话
- memory recall

### 通过标准

- `Runtime` 仍然是主调度对象
- 但内部状态变化路径更清晰
- 纯逻辑提取后更易测试和阅读

### 下一步

进入阶段4。

---

## 阶段4: 收口最终收束与完成链路

### 目标

把正式对话执行流程中的“最终消息收束”整理成明确步骤。

### 当前问题

当前 `core.ts` 末尾仍然持有这些关键逻辑:

- visibleTextBuffer 最终发出
- task complete 状态推进
- final message 选择
- session continuity commit
- completed event payload 的准备

这些都属于 “正式对话执行流程”的收尾阶段。

### 重构内容

在 `core.ts` 中形成明确的收尾流程步骤，例如:

- `finalizeConversationFlow(task, result, visibleTextBuffer)`

必要时由 `Runtime` 提供配套入口，例如:

- `finalizeChatTurn(task, result, visibleTextBuffer)`

目标是:

- `core.ts` 保留清晰的流程顺序
- `Runtime` 负责具体状态更新与结果计算

具体负责:

- 更新 last assistant output
- 选择最终可见 message
- 回写 session continuity
- 返回最终完成消息或完成载荷

不要让 `core.ts` 在结尾继续堆积零散收束逻辑。

### 验证

自动化测试至少包括:

- follow-up 最终答案正确写回 session continuity
- completed message 不回到中间态文本
- 连续对话中的“是的 / 继续”场景不回归

手工验证至少包括:

- 记忆检索后的 follow-up 回答
- 下一轮短句延续对话

### 通过标准

- `core.ts` 中最终收束成为明确的流程步骤
- session continuity 提交路径单一明确

### 下一步

进入阶段5。

---

## 阶段5: 行为性问题单独修复

### 目标

把当前已知但不适合与结构重构混做的问题放到单独阶段处理。

### 当前候选问题

- `allowMemorySave` 已计算但未真正进入执行裁决
- topic switch 边界未实现
- session memory lifecycle 尚未实现
- long memory 已加载导致 preload 规则过粗

### 原则

这些问题虽然重要，但它们属于“行为修正”，不是“Core 主链收口”。

如果和前四个结构步骤混做，会导致:

- 每一步都难以定位问题
- 验证维度混乱
- 回归成本明显提高

因此这些问题应在结构稳定后逐项单独处理。

---

## 推荐执行顺序

严格按以下顺序推进:

1. 阶段1：用户输入预处理链路收口
2. 验证并通过
3. 阶段2：Intent Request 执行链路收口
4. 验证并通过
5. 阶段3：Runtime 内部状态整理
6. 验证并通过
7. 阶段4：最终收束链路收口
8. 验证并通过
9. 阶段5：行为性问题单独修复

---

## 通过判定原则

每个阶段都必须同时满足:

- 自动化测试通过
- 至少一个对应手工场景通过
- 没有引入新的职责漂移
- `core.ts` 的流程结构更清晰
- `Runtime` 更接近主调度模块

如果不满足，则当前阶段不算完成，不进入下一阶段。

---

## 最终目标

通过渐进式重构，把当前 `Core` 主链逐步收敛为:

```text
Queue -> Runtime -> Transport -> Runtime
```

并达到以下结果:

- `Queue` 只负责推进任务
- `Transport` 只负责模型调用
- `Runtime` 真正成为 `Core` 的主调度和分配模块
- `core.ts` 成为清晰的函数式编排层
- 后续 memory / intent / follow-up 的扩展可以继续沿职责边界推进
