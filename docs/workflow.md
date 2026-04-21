# Workflow 微型文档

## 文档目的

本文件用于整理当前 `Core` 工作流的设计方向,明确后续分析和重构时应遵守的概念边界。  
它不是里程碑文档,也不是实施计划文档,而是一份面向讨论和继续设计的微型说明。

相关文档:

- [AGENTS.md](/Volumes/Projects/atom_next/AGENTS.md)
- [PLAN_0.10_CORE_RESTRUCT.md](/Volumes/Projects/atom_next/PLAN_0.10_CORE_RESTRUCT.md)
- [docs/memory-intent-request.md](/Volumes/Projects/atom_next/docs/memory-intent-request.md)

---

## Core 的工作流前提

当前项目中,`Core` 不是单一模块,而是由三部分共同组成:

- `Queue`
- `Runtime`
- `Transport`

默认主链路是:

```text
Queue -> Runtime -> Transport -> Runtime
```

这条链路表示:

- `Queue` 负责推进任务
- `Runtime` 负责准备上下文、解析结果、决定流转
- `Transport` 负责模型调用
- `Runtime` 在调用结束后继续处理结果并决定下一步任务

`core.ts` 的职责不是吞掉所有逻辑,也不是退化成空壳。  
它更适合作为 **函数式编排层**,用来把工作流的执行顺序写清楚。

---

## 当前问题

虽然当前代码已经开始引入 `workflows/`,但现在的 workflow 还更接近:

- 把原来大流程拆成几个函数
- 再在一次 `#workflow()` 调用里顺序执行

这还不是真正的工作流系统。  
当前真正缺少的是:

1. workflow 之间通过 `Queue` 交接
2. `Runtime` 统一解析上一步输出并生成下一步任务
3. 不同阶段统一使用同一种内部请求协议

也就是说,真正的 workflow 不应该是:

```text
workflow A -> 直接调用 -> workflow B
```

而应该是:

```text
workflow A -> Runtime 产出内部请求/任务 -> Queue -> workflow B
```

---

## Workflow 的核心设计

### 1. workflow 之间通过内部任务连接

每个 workflow 只完成一个明确阶段,不应该直接调用下一个 workflow。

一个 workflow 的输出应该收口成两类:

- 更新 `Runtime` 状态
- 生成下一条内部任务,交还给 `Queue`

这样工作流连接关系才会清晰:

```text
Queue -> Runtime -> Transport -> Runtime -> Queue -> ...
```

### 2. `Runtime` 是工作流的主要调度模块

在工作流中:

- `Queue` 负责推进
- `Transport` 负责调用
- `Runtime` 负责解释“这一步意味着什么”

也就是说:

- `Runtime` 负责解析模型输出
- `Runtime` 负责把输出映射成内部请求
- `Runtime` 负责决定是否产生下一条内部任务

### 3. `core.ts` 是函数式编排层

`core.ts` 可以保留为工作流编排入口,但不应该持有大量具体业务分支。

它应优先表达:

- 当前任务属于哪条 workflow
- 当前 workflow 结束后是否需要新任务
- Queue 应如何推进

而不是在 `core.ts` 中直接展开:

- memory 读写细节
- request 类型分支
- prompt 组合细节

---

## Intent Request 的统一定义

为了保证 workflow 形式统一,这里将 `Intent Request` 扩展定义为:

> `Intent Request` 是 Core 内部通用的工作流请求协议。

这意味着它不只用于:

- 正式对话阶段由 LLM 输出的请求

也可以用于:

- 用户输入意图预测阶段产出的内部请求

换句话说,`Intent Request` 不再只表示“对话中的 LLM 请求”,  
也可以表示“系统前置流程产出的内部工作流请求”。

这个定义的好处是:

1. workflow 结构统一
2. `Runtime` 解析入口统一
3. `Queue` 交接模型统一

---

## Intent Request 的来源分类

虽然统一为 `Intent Request`,但不同来源的语义仍然不同。  
为了避免混淆,建议在内部保留来源分类。

至少应区分两类:

- `prediction`
- `conversation`

含义如下:

### `prediction`

来自用户输入意图预测流程。  
它代表系统在正式对话前,基于用户输入生成的工作流请求。

例如:

- 请求加载某类记忆
- 请求生成正式对话任务
- 请求进入特定对话变体

### `conversation`

来自正式对话中 LLM 输出的请求。  
它代表模型在回答过程中发出的运行时请求。

例如:

- `SEARCH_MEMORY`
- `FOLLOW_UP`
- `SAVE_MEMORY`
- `LOAD_MEMORY`

保留来源字段的意义在于:

- safety 规则可以按来源区分
- debug 时能知道请求来自哪个阶段
- prediction 与 conversation 不会在语义上再次混淆

---

## 推荐的工作流形态

### 1. 用户输入意图预测工作流

目标:

- 在正式对话前分析用户输入
- 产出可执行的内部 `Intent Request`
- 不直接进入正式对话

推荐链路:

```text
External User Task
-> Queue
-> UserIntentPredictionWorkflow
-> Runtime 写入 prediction 上下文
-> Runtime 生成 prediction 来源的 Intent Request
-> Runtime 生成正式对话任务
-> Queue
```

这一阶段的结果不应该只是“算出一个字段对象”,  
而应该是能够进入统一 workflow 体系的内部请求或内部任务。

### 2. 正式对话工作流

目标:

- 导出正式 prompt
- 执行对话模型调用
- 解析对话产生的 `Intent Request`
- 决定是否继续 follow-up

推荐链路:

```text
Formal Conversation Task
-> Queue
-> FormalConversationWorkflow
-> Runtime 准备 prompt
-> Transport 流式输出
-> Runtime 解析 conversation 来源的 Intent Request
-> Runtime 生成 FollowUpTask / ClosureTask / Complete
-> Queue
```

### 3. Follow-up 工作流

目标:

- 处理正式对话生成的内部续跑任务
- 保证同一 chat 的链式回答继续进行

推荐链路:

```text
FollowUp Task
-> Queue
-> FormalConversationWorkflow
-> Runtime 复用已有 chat 上下文
-> Transport
-> Runtime 决定是否继续产生内部任务
-> Queue
```

---

## 当前建议

基于当前实现阶段,后续 workflow 设计建议遵守下面几条:

### 1. 不要把 workflow 简化成“函数调用链”

函数式实现是对的,但 workflow 的关键不是函数形式,而是:

- 每个阶段职责清晰
- 阶段之间通过 `Queue` 和内部任务交接

### 2. `Runtime` 应该统一解析上一步输出

不论输出来自:

- 用户输入意图预测
- 正式对话

都应该由 `Runtime` 负责把它解析成下一步的内部请求和任务。

### 3. `Intent Request` 可以宽松,但要保留来源信息

统一协议是为了 workflow 一致性。  
来源区分是为了避免语义混乱。

### 4. 先统一协议,再继续细化流程

当前更重要的是把:

- prediction
- conversation
- follow-up

三类流程放进同一种内部工作流语言中。  
而不是先继续增加新的 manager 或新的 prompt 变体。

---

## 目前不在本文处理的内容

本文件只整理 workflow 设计,不处理下面这些具体实现问题:

- `allowMemorySave` 执行裁决
- topic switch 边界
- session memory lifecycle
- queue 的事件边界
- `runloop` 防重入策略细节
- `Transport` partial stream error 建模

这些属于后续具体实现或稳定性治理问题,不混进本文。
