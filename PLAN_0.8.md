# PLAN 0.8

## 文档目的

本文件只用于拆解 `0.8` 里程碑中 **目标2: 实现 Core 模块内部连续会话功能** 的实现计划。  
计划必须建立在当前项目已有实现之上，不额外扩展目标1中尚未落地的记忆检索、记忆保存、技能加载业务。

---

## 当前结论

### 目标1当前完成度

当前 `Intent Request` 已经完成以下能力:

- 请求文本解析
- 请求结构化建模
- 请求安全检查
- 占位分发结果输出

当前 `Intent Request` 还没有完成以下能力:

- `SEARCH_MEMORY` 的真实执行
- `SAVE_MEMORY` 的真实执行
- `LOAD_SKILL` 的真实执行
- 请求结果回灌到下一轮 `Context`
- `FOLLOW_UP` 的真实续会话动作

因此，目标2不能建立在“目标1已完整闭环”的假设上，只能建立在“目标1已经提供了 `FOLLOW_UP` 的解析和安全校验入口”这个事实上。

### 目标2当前结论

当前项目中，目标2需要的部分基础已经存在:

- `FOLLOW_UP` 类型已定义并可解析
- `Transport.send()` 已支持 `maxOutputTokens`
- `Task` 已具备 `chainId` / `parentId` / `source`
- `SessionManager` 已支持同一个 `chatId` 持续追加 chunk

但连续会话闭环还没有实现，关键缺口如下:

- `FOLLOW_UP` 仍然只是占位分发结果
- `Core` 在解析完 request 后会立刻完成 chat
- `Runtime` 的 `round` 语义还没有按 `sessionId + chatId` 正确落实，内部续跑轮次也缺少独立跟踪字段
- `Runtime` 当前维护的 `<Context>` 还不足以承担 follow-up 续跑上下文
- 队列中的链式任务排序工具还没有接入生产流程
- follow-up 子任务的构造入口还不存在

---

## RawTaskItem约束分析

`RawTaskItem` 声明位于 [src/types/task.ts](/Volumes/Projects/atom_next/src/types/task.ts:73)。

### 字段语义

- `id`
  - 每个任务的唯一标识。
  - follow-up 子任务必须生成新的 `id`。

- `chainId`
  - 标识同一条连续任务链。
  - 根任务默认 `chainId = id`。
  - follow-up 子任务必须继承根任务的 `chainId`，不能重新生成。

- `parentId`
  - 指向直接上游任务。
  - 根任务默认 `parentId = id`。
  - follow-up 子任务必须把 `parentId` 指向当前已完成的上游任务，而不是指向根任务。

- `sessionId`
  - 会话级身份。
  - 连续会话必须复用原值，不能切换 session。

- `chatId`
  - 对外 chat 身份。
  - 连续会话对外仍然是一次对话，因此 follow-up 子任务必须复用原值。

- `chain_round`
  - 建议作为 `RawTaskItem` 的可选字段增加。
  - 该字段只服务内部连续会话轮次跟踪，不参与外部 chat 轮次计算。
  - 初始外部任务不包含该字段。
  - 只有第一次创建内部 follow-up 任务时，才显式写入该字段。
  - 第一个内部 follow-up 任务的 `chain_round = 1`。
  - 后续 follow-up 子任务在上一个内部任务基础上递增。

- `state`
  - 当前任务执行状态。
  - 现有状态中已经存在 `FOLLOW_UP`，但从当前设计来看，不一定必须把它作为对外状态公开。
  - 第一版更稳妥的方式是继续以 `WAITING/PENDING/PROCESSING/COMPLETE/FAILED` 驱动外部表现，避免额外改动 API 语义。

- `source`
  - `EXTERNAL` 与 `INTERNAL` 的来源区分已经存在。
  - follow-up 子任务应当使用 `TaskSource.INTERNAL`。

- `priority`
  - 数字越小优先级越高。
  - 优先级模型需要体现“先阻止错误扩散，再继续内部会话”的执行顺序。
  - `终止任务` 的优先级最高，用于 Agent 发生错误时及时阻止继续运行。
  - `FOLLOW_UP` 内部任务的优先级高于普通任务，但低于 `终止任务`。
  - `终止任务` 不在当前里程碑中实现，但目标2实现时必须预留该优先级层级。
  - 当前先固定优先级约定如下:
    - `0`: 终止任务
    - `1`: `FOLLOW_UP` 内部任务
    - `2`: 普通任务

- `eventTarget`
  - 外部事件同步出口。
  - follow-up 子任务如果希望继续把 chunk 追加到同一个 chat，需要复用原任务的 `eventTarget`。

- `channel`
  - 标识任务来自 `tui` 或 `gateway`。
  - follow-up 子任务应当继承原任务 `channel`，不能丢失来源信息。

- `payload`
  - 当前任务提交给 Runtime 的输入负载。
  - follow-up 子任务的 payload 不能沿用“原始用户输入”语义，而应该是“续会话输入”。
  - 这部分必须在任务创建时一次性构造好。

- `createdAt` / `updatedAt`
  - 任务生命周期时间。
  - follow-up 子任务应当拥有新的时间戳。

### 对实现方案的直接影响

- `TaskItem` 只有 `state` 和 `updatedAt` 可以修改。
- `source`、`chainId`、`parentId`、`payload`、`channel`、`chain_round` 都应视为创建后只读数据。
- 因此 follow-up 子任务不能先创建一个“半成品”再补字段，必须在构造时一次性完整生成。
- 当前 `TaskItemInput` 只允许构造外部任务，不足以构造 follow-up 子任务。
- 目标2必须先补一个“内部任务构造入口”，否则后续所有设计都无法落地。

---

## 实现边界

### 本次目标2只做

- 让 `FOLLOW_UP` 从“占位 request”变成“可真实派生内部任务”
- 让 Core 内部可以将一次外部 chat 拆成多轮 LLM 提交
- 让多轮提交对外仍然表现为同一个 `chatId` 的连续输出

### 本次目标2不做

- 不实现 `SEARCH_MEMORY` / `SAVE_MEMORY` / `LOAD_SKILL` 的真实业务
- 不实现完整的 Context 记忆回灌系统
- 不扩展新的外部 API
- 不引入新的复杂事件协议
- 不重做整个 TaskQueue 架构

---

## 前置门槛

在进入其他阶段之前，必须先实现一个**最小可执行的 Runtime Context**，并通过对应测试。

这一步是后续所有 FOLLOW_UP 开发的前置条件，未完成前不得继续推进:

- 内部任务模型与构造入口
- `FOLLOW_UP` 调度逻辑
- 队列优先级策略
- 对外 chat 生命周期收口

前置门槛通过标准:

- Runtime 能把第一轮原始用户输入写入上下文
- Runtime 能累计每轮 assistant 可见输出
- `<Context>` 中新增明确的 follow-up 上下文区块
- 同一个 `chatId` 内 follow-up 续跑不再依赖重复提交完整用户输入
- 对应测试全部通过

---

## Runtime 轮次语义

### `round` 的正确语义

`Runtime` 中的 `round` 不是“内部连续续跑的轮数”，而是**基于 `sessionId + chatId` 的外部对话轮数**。

规则如下:

- 同一个 `sessionId` 下，同一个 `chatId` 只算一轮
- 只有 `chatId` 发生变化时，`round` 才更新
- 同一个 `chatId` 内部发生多少次 follow-up，都不应该推动 `round` 增长

这意味着:

- 目标2中的内部连续会话，不应该直接复用 `round` 作为内部续跑计数
- 对外仍然只有一个 `chatId`，所以整个连续会话过程中，`round` 应保持稳定

### `chain_round` 的用途

如果需要追踪同一个 `chatId` 内部发生了多少次续跑，应当单独增加 `chain_round` 作为内部跟踪参数。

建议将 `chain_round` 设计为 `RawTaskItem` 的可选字段，而不是 Runtime 的临时派生状态。

`chain_round` 的建议语义:

- 初始外部任务不设置 `chain_round`
- 第一次派生内部 follow-up 任务时，`chain_round = 1`
- 后续每派生一次 follow-up 子任务，`chain_round + 1`
- `chain_round` 只服务 Core 内部连续会话
- `chain_round` 不替代 `round`
- `chain_round` 不直接改变对外 chat 生命周期语义
- `chain_round` 仅在 `FOLLOW_UP` 链路中使用，普通任务保持缺省

### 对目标2的直接影响

- `round` 负责表达“当前外部是第几次 chat 提交”
- `chain_round` 负责表达“当前 chat 内部已经续跑到第几轮”
- 目标2实现时，必须显式区分这两个概念，不能把内部 follow-up 次数错误映射到 `round`

---

## 固定优先级约定

为了避免后续实现和测试时重复解释，目标2当前阶段先固定任务优先级如下:

- `priority = 0`
  - 终止任务
  - 用于 Agent 发生错误时，优先阻止继续运行

- `priority = 1`
  - `FOLLOW_UP` 内部任务
  - 用于保证内部连续会话优先于普通任务继续执行

- `priority = 2`
  - 普通任务
  - 当前外部任务默认保持该优先级

说明:

- 当前里程碑不实现终止任务本身
- 但目标2实现时，必须按这个优先级模型预留位置
- follow-up 子任务应明确使用 `priority = 1`

---

## 阶段拆解

## 阶段0: 先实现 Runtime Context 的最小可执行目标

### 目标

先让 Runtime 真正维护 follow-up 续跑所需的最小上下文，并通过测试。  
在这一阶段通过之前，其他阶段一律不开始实施。

### 模块拆解

#### 模块 A: `src/core/runtime/runtime.ts`

小目标:

- 扩展 `RuntimeContext`，让它不再只包含空的 `Meta/Channel/Memory` 骨架
- 在现有 `<Context>` 中新增专门的 `FollowUp` 区块
- `FollowUp` 第一版最小字段固定为:
  - `chatId`
  - `chain_round`
  - `originalUserInput`
  - `accumulatedAssistantOutput`
- 第一轮外部任务运行前，将原始用户输入写入 `originalUserInput`
- 每轮输出结束后，将 assistant 可见输出累计写入 `accumulatedAssistantOutput`
- 同一个 `chatId` 的 follow-up 轮次中，后续续跑上下文优先从 Runtime Context 提供

#### 模块 B: Runtime Prompt 输出

小目标:

- `exportSystemPrompt()` 输出的 `<Context>` 中包含 `FollowUp` 区块
- `FollowUp` 区块的字段输出规则在第一版固定，不允许实现阶段临时决定
- 第一版只做“原始输入 + 累计输出”的最小上下文，不扩展到完整 memory 系统

#### 模块 C: 测试门槛

小目标:

- 为 Runtime Context 最小能力补测试
- 必测场景:
  - 第一轮执行前写入 `originalUserInput`
  - 每轮执行后累计 `accumulatedAssistantOutput`
  - `<Context>` 中稳定输出 `FollowUp` 区块
  - 同一个 `chatId` 的续跑阶段不需要重复完整用户输入

阶段门槛:

- 只有本阶段测试通过后，才允许开始阶段1及后续开发

---

## 阶段1: 明确内部 follow-up 任务模型

### 目标

先补足“连续会话内部任务”最小建模能力，让目标2有合法的数据载体。

### 模块拆解

#### 模块 A: `src/types/task.ts`

小目标:

- 确认 `RawTaskItem` 是否足够表达 follow-up 子任务
- 将 `chain_round` 设计为 `RawTaskItem` 的可选字段
- 明确初始外部任务不包含 `chain_round`
- 明确第一次内部任务创建时写入 `chain_round = 1`
- 明确 `TaskState.FOLLOW_UP` 在目标2中的用途
- 明确 `TaskItemInput` 只适用于外部任务，不直接承担内部任务构造职责

结论要求:

- 明确内部任务是否需要新的输入类型
- 明确 `chain_round` 只用于 follow-up 链路
- 明确 `chain_round` 的起点发生在第一次内部任务创建时
- 明确不修改已有外部任务创建语义

#### 模块 B: `src/libs/task.ts`

小目标:

- 为 follow-up 子任务提供专用构造入口
- 保持现有 `buildTaskItem()` 继续只服务外部任务
- 保证内部任务构造时可以显式设置:
  - `source`
  - `chainId`
  - `chain_round`
  - `parentId`
  - `priority`
  - `payload`
  - `eventTarget`
  - `channel`

验收标准:

- 可以合法构造 `TaskSource.INTERNAL` 的只读任务对象
- 不破坏现有外部任务测试语义

---

## 阶段2: 补齐 Runtime 的连续会话上下文

### 目标

在阶段0最小 Context 已经可运行的基础上，补齐 Runtime 的轮次语义，让 Runtime 能同时区分“当前外部 chat 是第几轮”和“当前内部续跑是第几轮”。

### 模块拆解

#### 模块 A: `src/core/runtime/runtime.ts`

小目标:

- 当前任务切换时同步 `sessionId`
- 当前任务切换时同步 `channel.source`
- 按 `sessionId + chatId` 维护 `round`
- 如果需要内部续跑计数，优先从当前 `TaskItem.chain_round` 读取
- 让 `#taskSessions` 从占位字段变成真实的轮次跟踪结构

验收标准:

- 第一轮外部 chat 导出的 prompt 中 `Round = 1`
- 同一个 `chatId` 的 follow-up 过程中，`Round` 保持不变
- 同一条连续任务链的 follow-up 轮次可以通过 `chain_round` 正确递增

#### 模块 B: Runtime Prompt 组织

小目标:

- 设计 follow-up 轮次的输入组织方式
- 明确下一轮 prompt 至少要知道:
  - 这是同一次外部对话的继续
  - 当前外部 `round` 是多少
  - 当前内部 `chain_round` 是多少
  - 为什么继续
  - 续跑所需的原始输入和累计输出来自 Runtime Context，而不是重复完整用户输入

约束:

- 阶段0已经固定 Runtime Context 最小字段
- 第一版不引入完整历史上下文存储系统

---

## 阶段3: 将 `FOLLOW_UP` 从占位结果升级为可执行信号

### 目标

让 `FOLLOW_UP` 不再只用于打印日志，而是真正驱动 Core 派生后续任务。

### 模块拆解

#### 模块 A: `src/core/runtime/intent-request.ts`

小目标:

- 保留当前解析和安全检查结构不变
- 为 `FOLLOW_UP` 增加“可被 Core 识别为续跑信号”的输出形式
- 不要求此阶段实现 memory/skill 的真实动作

约束:

- 不打散现有 `dispatchIntentRequests()` 结构
- 只对 `FOLLOW_UP` 增加最小必要能力

#### 模块 B: `src/core/runtime/runtime.ts`

小目标:

- `parseLLMRequest()` 返回结果后，能让上游准确判断是否存在安全通过的 `FOLLOW_UP`
- 不把 follow-up 判断散落到多个模块

验收标准:

- Core 可以只依赖 Runtime 返回结果，就判断当前轮是否需要续跑

---

## 阶段4: 在 Core 中建立连续会话主流程

### 目标

把目标2真正接入主执行链路。

### 模块拆解

#### 模块 A: `src/core/core.ts`

小目标:

- 在当前工作流中，把“解析 request”放到“决定是否完成 chat”之前
- 如果没有安全通过的 `FOLLOW_UP`:
  - 保持现有完成逻辑
- 如果存在安全通过的 `FOLLOW_UP`:
  - 不立即发送最终 `CHAT_COMPLETED`
  - 派生新的内部任务
  - 将该任务重新放入队列

关键约束:

- 对外仍然使用同一个 `sessionId/chatId`
- 不为中间轮次创建新的 chat
- 中间轮次只能继续追加 chunk，不能提前结束 chat

#### 模块 B: follow-up payload 设计

小目标:

- 定义 follow-up 子任务的最小 payload 内容
- payload 需要能够表达“续会话意图”，而不是重复原始用户输入
- payload 必须适配 `Runtime.#convertTaskToPrompt()` 当前只读取 text 的实现
- payload 与 `chain_round` 需要一起工作，让 Runtime 能区分当前是第几次内部续跑

约束:

- follow-up 续跑所需的主体上下文已经由 Runtime Context 提供
- 内部任务 payload 第一版不再承担完整上下文快照职责
- 内部任务 payload 只保留最小续跑指令和必要标记

验收标准:

- follow-up 子任务提交给 Runtime 后，可以形成一段新的用户输入提示

---

## 阶段5: 让 follow-up 任务优先执行

### 目标

满足当前实现约束下的优先级要求:

- `终止任务` 为最高优先级，用于错误场景下及时阻止继续运行
- `FOLLOW_UP` 内部任务优先级高于普通任务
- `FOLLOW_UP` 内部任务优先级低于终止任务
- 不歪曲当前 `activeQueue` 的语义

### 模块拆解

#### 模块 A: `src/core/queue/queue.ts`

小目标:

- 通过 `priority` 实现清晰的三层优先级语义:
  - 终止任务
  - follow-up 内部任务
  - 普通任务
- 固定优先级数值:
  - `0` = 终止任务
  - `1` = follow-up 内部任务
  - `2` = 普通任务
- 保持普通外部任务现有优先级行为不变

建议:

- 第一版优先使用 priority，而不是直接重定义 `activeQueue`

#### 模块 B: `src/core/queue/resort.ts`

小目标:

- 评估是否需要在生产流程接入 `resort`
- 如果 follow-up 链路只靠 priority 已能稳定满足目标，可将 `resort` 接入延后
- 如果需要稳定保证同一链任务连续执行，再考虑让 `TaskQueue.addTask()` 使用 `resort`

决策标准:

- 如果目标2第一版只产生一条立即续跑的子任务，priority 通常足够
- 如果后续允许多个链式内部任务并存，再引入 `resort` 更合适

---

## 阶段6: 明确对外 chat 生命周期表现

### 目标

确保对外仍然是“一次 chat”，而不是多次 chat 拼接。

### 模块拆解

#### 模块 A: `src/api/session/session.ts`

小目标:

- 保持现有 `appendChunk()` 逻辑继续服务多轮输出
- 中间 follow-up 轮次不触发最终完成
- 仅在最后一轮没有 `FOLLOW_UP` 时触发 `completeChat()`

验收标准:

- 同一个 `chatId` 可以经历多轮 chunk 追加
- 最终仍只产生一个完成态消息

#### 模块 B: `src/types/event.ts`

小目标:

- 评估是否需要新增事件
- 第一版优先不新增事件
- 继续复用:
  - `CHAT_ACTIVATED`
  - `CHAT_CHUNK_APPENDED`
  - `CHAT_COMPLETED`

结论方向:

- 若当前事件足以表达状态推进，则不新增事件

---

## 阶段7: 限制输出长度并建立续跑约束

### 目标

让模型具备“接近输出上限时主动发 `FOLLOW_UP`”的运行条件。

### 模块拆解

#### 模块 A: `src/core/transport/transport.ts`

小目标:

- 明确目标2是否使用固定的 `maxOutputTokens`
- 让 Core 在调用 `send()` 时传入参考输出上限

约束:

- 第一版使用固定参考值即可
- 不做复杂动态 token 预算

#### 模块 B: `src/core/runtime/runtime.ts`

小目标:

- 在系统提示词或上下文中明确告知模型:
  - 接近输出上限时，使用 `FOLLOW_UP`
  - `FOLLOW_UP` 需要绑定当前 `sessionId/chatId`

验收标准:

- 目标2具备完整协议闭环前提

---

## 阶段8: 测试补齐

### 目标

为目标2补足最小必要测试，保证后续迭代可维护。

### 模块拆解

#### 模块 A: `tests/core/runtime/intent-request.test.ts`

小目标:

- 保留现有解析/校验测试
- 增加 `FOLLOW_UP` 作为真实续跑信号时的测试设计

#### 模块 B: `tests/core/queue/task.test.ts`

小目标:

- 为内部任务构造入口增加测试
- 验证 `chainId/parentId/source/payload/channel/eventTarget` 是否按预期冻结

#### 模块 C: `tests/core/queue/queue.test.ts`

小目标:

- 验证 follow-up 子任务优先级是否高于普通任务
- 验证优先级模型中已为终止任务保留更高档位
- 验证内部任务默认不产生多余外部状态事件

#### 模块 D: 新增或扩展 Core 层测试

小目标:

- 验证“存在 `FOLLOW_UP` 时不立即 complete”
- 验证“最终轮才 complete”
- 验证“同一个 `chatId` 贯穿多轮”

备注:

- 当前 `tests/core` 下还没有 `core.ts` 工作流测试，目标2大概率需要补这一层

#### 模块 E: Runtime Context 前置测试

小目标:

- 为阶段0新增或扩展 Runtime 相关测试
- 将其视为后续阶段的准入测试
- 后续阶段开始前，必须先确认该组测试通过

---

## 推荐实施顺序

建议严格按下面顺序推进:

1. 阶段0: Runtime Context 最小可执行目标
2. 阶段1: 内部任务模型与构造入口
3. 阶段2: Runtime 连续会话轮次语义
4. 阶段3: `FOLLOW_UP` 从占位升级为可执行信号
5. 阶段4: Core 主流程接入 follow-up 派生
6. 阶段5: follow-up 优先级策略
7. 阶段6: 对外 chat 生命周期校准
8. 阶段7: 输出上限与续跑约束
9. 阶段8: 测试补齐

执行门槛:

- 阶段0未通过测试前，不进入阶段1
- 阶段0测试通过后，才能继续后续所有开发

---

## 第一版最小验收标准

目标2第一版完成时，应满足以下条件:

- Runtime Context 最小能力已先完成，并通过测试
- LLM 返回安全通过的 `FOLLOW_UP` 时，Core 不会立即结束当前 chat
- Core 会派生一个新的 `INTERNAL` 任务
- 新任务复用原 `sessionId/chatId`
- 新任务正确继承 `chainId`，并把 `parentId` 指向直接上游任务
- 新任务在 follow-up 链路中携带正确的 `chain_round`
- 新任务明确使用 `priority = 1`
- follow-up 轮次不再依赖重复提交完整用户输入
- 同一个 chat 可以跨多轮持续追加 chunk
- 只有最后一轮没有 `FOLLOW_UP` 时才触发 `CHAT_COMPLETED`

---

## 当前实现策略建议

为了严格符合现有项目风格，目标2建议采用以下实现策略:

- 少改动、强复用，不单独新起连续会话子系统
- 先实现 Runtime Context 的最小可执行版，并以测试通过作为后续开发门槛
- 先只打通 `FOLLOW_UP`，不顺手实现其他 Intent Request 业务
- 优先利用 `priority` 建立“终止任务 > FOLLOW_UP 内部任务 > 普通任务”的优先级关系
- 终止任务当前里程碑不实现，但要提前为错误中断场景预留最高优先级
- 只有在 priority 不足以保证链式顺序时，才接入 `resort`
- 所有新增逻辑优先落在已有职责边界内:
  - Task 类型与构造: `src/types/task.ts` / `src/libs/task.ts`
  - request 协议处理: `src/core/runtime/*`
  - 连续任务调度: `src/core/core.ts`
  - 队列优先级: `src/core/queue/*`
  - 对外 chat 表现: `src/api/session/session.ts`
