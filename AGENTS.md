<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# AGENTS.md

## Code Guide

- Less Code, More Power
- 使用语义明确的函数命名，比如解析参数使用 `parseParam`，而不是 `normalizeParam`
- “重构”的意义不是简单的拆分文件，同时也是将相同功能的代码聚合，达到最大化的复用效果
- 思考问题时候需要基于已有的代码实现，不要节外生枝在已有代码基础上添加不必要的新功能和新业务
- 代码风格要与现有项目一致，如果不知道代码风格可以先读取最大的代码文件
- 先读现有实现，再决定是否修改
- 优先补全现有职责边界，不额外发散新思路
- 只有确认出现明确重复、冲突或扩展阻塞时，才做重构

## Naming Convention

- `create` — 从无到有创造新实体（如 `createTaskItem`、`createError`）
- `build` — 组装现有部件（如 `buildRipgrepArgs`、`buildTuiRendererConfig`）
- `parse` — 解析文本为结构化数据（如 `parseIntentRequest`）
- `resolve` — 按条件查找或推导（如 `resolveIntentPolicy`）

## Core Concept

`Core` 是一个抽象概念，不是单一模块，也不是单一类。

当前项目中，`Core` 由以下三个模块共同组成：

- `Runtime`
- `Transport`
- `Queue`

后续所有开发、重构和职责讨论，都必须基于这个概念进行，不要再把 `Core` 理解成某一个具体文件或某一个中心对象。

## Core Flow

`Core` 内部模块默认按流式链路协作：

```text
Queue -> Runtime -> Transport -> Runtime
```

这表示：

- `Queue` 负责推进任务进入运行态
- `Runtime` 负责在调用前准备上下文、策略和调度信息
- `Transport` 负责执行模型调用
- `Runtime` 负责接收调用结果、更新上下文、决定后续流转

后续开发应优先遵守这条主链，不要随意形成反向依赖或跨层直连。
尤其不要让 `Transport` 反向持有 `Runtime` 业务状态，也不要让 `Queue` 直接介入 prompt 或模型调用细节。

## Core Responsibilities

### Runtime

`Runtime` 是一个抽象的运行时服务域，不应该再被理解成某一个单独的类或某一个单独的文件。

当前代码中的 `runtime.ts` 只是 `Runtime` 在 `Core` 内部的统一入口。

后续开发时，必须基于下面这个认知：

- `Runtime` = 一组运行时内核服务的集合
- `runtime.ts` = `Runtime` 域在内核中的唯一对外暴露接口
- `workflow` / `core.ts` / 其他内核模块不得直接依赖 `runtime/*` 子模块实现细节

`Runtime` 负责运行时上下文与状态编排，包括但不限于：

- session / chat 上下文管理
- prompt 上下文组装
- memory 上下文管理
- 用户输入意图预测结果与策略状态的编排入口
- 对话连续性相关状态维护
- Core 内部主调度与结果分配

`Runtime` 是 `Core` 中主要的调度和分配模块。

`Runtime` 不应该承担模型通信职责，也不应该承担任务排队职责。

`Runtime` 对外应该只暴露高层动作，不应该把内部服务对象继续向外透传。

默认约束：

- `Runtime` 域内部可以继续拆分 `context`、`prompt`、`intent-request`、`prediction`、`finalize` 等子模块
- 这些子模块属于 `Runtime` 的内部实现，不属于对外边界
- 如果某个能力需要被 workflow 使用，应先收敛到 `Runtime` 统一入口，再由 workflow 调用
- 不要通过 `getXxxManager()` 之类的方式把内部服务对象再暴露给外部

判断标准：

- 如果一个能力属于运行时上下文、策略编排、结果收束，它应该归属 `Runtime`
- 如果一个能力只是 `Runtime` 的内部实现细节，它不应该被内核其他模块直接 import
- 如果一个方法不是 workflow 真正需要的高层动作，不要继续挂到 `Runtime` 的对外接口上

### Transport

`Transport` 负责与模型通信，包括但不限于：

- 用户输入意图预测调用
- 正式回答调用
- 流式输出处理

`Transport` 不负责运行时上下文持久化，也不负责任务调度。

### Queue

`Queue` 负责任务调度，包括但不限于：

- 任务入队
- 任务出队
- 任务激活顺序
- 基础任务生命周期推进

`Queue` 不负责 prompt 组装，不负责模型调用，不负责 memory 编排。

## Development Rule

当涉及 `Core` 相关修改时，必须先判断问题属于哪一层：

- 属于 `Runtime`
- 属于 `Transport`
- 属于 `Queue`

只有在确实需要跨模块协调时，才在 `core.ts` 这类协调层处理。

不要把原本应该收敛到 `Runtime`、`Transport` 或 `Queue` 的职责继续堆积到单一协调器中。

当涉及 `Runtime` 相关修改时，额外遵守下面规则：

- 优先先判断这个改动是 `Runtime` 的对外动作，还是 `Runtime` 的内部服务实现
- 如果是内部实现，优先下沉到 `runtime/*` 子模块，不要直接继续堆到 `runtime.ts`
- 如果是对 workflow 暴露的能力，统一经由 `Runtime` 入口暴露，不要让 workflow 直接依赖内部子模块
- 保持 `Runtime` 作为唯一对外入口，但不要把它扩张成“万能对象”

## Implementation Style

`Core` 相关开发优先使用“函数式 + OOP”混合方式，而不是单纯依赖 OOP 互相调用。

推荐原则：

- 对象负责承载状态、生命周期和清晰边界
- 函数负责纯计算、解析、格式化、策略裁决和可复用逻辑
- 优先把可测试的纯逻辑做成函数
- 只有在确实需要状态封装时，才引入类或对象方法

避免的问题：

- 为了封装而封装，导致对象之间层层互调
- 过多小对象互相引用，导致调用链分散
- 纯逻辑被塞进类方法里，增加调试成本
- 到处导出零散对象实例，导致后续排查和重构困难

默认做法：

- 状态相关职责放在对象中
- 无状态逻辑优先抽为函数
- 先保证调用链清晰，再考虑抽象层次
