# Tools

## 文档目的

本文件用于说明 `atom_next` 系统内 `tools` 能力的设计边界、模块职责和默认工作链路。  
它是 `0.12` 里程碑对应的 Tools 设计文档,不承担具体实现步骤拆解职责。

---

## 为什么需要独立的 Tools 能力

当前 `atom_next` 已经具备:

- `Queue -> Runtime -> Transport -> Runtime` 的主链路
- `Intent Request` 作为内部工作流请求协议
- `FOLLOW_UP` 续跑机制
- `MemoryService` 作为独立基础服务

但系统还没有真正的“工具调用”能力。

这意味着:

- 模型当前只能输出文本和 `Intent Request`
- 无法在一次正式对话里真实读取文件、搜索代码、执行命令
- 无法让模型在同一轮回答中基于工具结果继续决策
- `FOLLOW_UP` 虽然存在,但还不能承接工具执行后的连续推理

因此 `0.12` 的目标不是临时增加几个命令入口,而是在系统内正式建立一套独立的 Tools 能力,让模型可以在受控边界内完成:

- 工具选择
- 工具执行
- 工具结果回灌
- 基于工具结果继续推理
- 必要时进入 `FOLLOW_UP`

---

## 核心结论

`tools` 在 `atom_next` 中应当被定义为:

> 一个独立于 `Runtime(Core)` 内部实现细节之外的基础能力域,由独立服务提供工具定义与执行能力,由 `Runtime` 负责运行时编排,由 `Transport` 负责承载模型侧 tool calling,由 `Queue` 继续负责任务推进。

这里的关键约束是:

- `Tools` 不是 `Runtime` 的子模块实现
- `Tools` 不是 `Transport` 的业务分支
- `Tools` 不是 `Queue` 的调度职责
- `Tools` 也不应该被重新包装成一套新的文本协议

---

## 设计目标

`0.12` 阶段的 Tools 系统应达到下面几个目标:

1. 系统内有独立的工具服务边界
2. 正式对话支持真实 tool calling
3. 同一轮 conversation 支持多步工具调用
4. `FOLLOW_UP` 可以继续消费前一轮工具结果摘要
5. 工具权限、预算和执行结果可观测
6. `Runtime / Transport / Queue` 三层职责不被打乱

---

## 模块边界

### ToolService 负责

`ToolService` 应当负责:

- 注册内置工具
- 管理工具 registry
- 暴露工具定义与执行上下文
- 处理工具权限策略
- 处理工具预算限制
- 处理工具执行前 guard
- 处理工具执行后 settled 回调
- 统一工具输出包装和错误归一化

`ToolService` 不应当负责:

- session / chat 运行时状态编排
- `FOLLOW_UP` 任务派生
- prompt 拼接
- 模型请求发送
- 任务排队

也就是说:

- `ToolService` 负责工具本身
- `Runtime` 负责调用时机和上下文编排
- `Transport` 负责模型与 tool calling 通信

### Runtime 负责

`Runtime` 在 Tools 链路中的职责应当是:

- 基于当前 task 构造工具执行上下文
- 暴露当前轮次可用的 tool registry
- 记录工具执行摘要
- 把工具结果摘要组织进运行时上下文
- 在工具调用结束后决定是否继续对话或进入 `FOLLOW_UP`

`Runtime` 不应当:

- 直接实现具体工具
- 直接持有工具注册表内部细节
- 把 `ToolService` 内部对象向 workflow 继续外露

### Transport 负责

`Transport` 在 Tools 链路中的职责应当是:

- 将 `system prompt + user prompt + tools` 提交给模型
- 承载模型原生 tool calling
- 接收工具调用事件
- 将工具结果回灌给模型
- 在满足 stop 条件前继续同一轮工具调用循环

`Transport` 不应当:

- 决定哪些工具应该开放
- 决定工具权限
- 持有 `Runtime` 业务状态
- 直接操作 task queue

### Queue 负责

`Queue` 的职责保持不变:

- 任务入队
- 任务激活
- 任务状态推进
- 内部任务续跑

`Queue` 不应当:

- 关心具体工具定义
- 关心工具执行结果结构
- 介入 tool calling 过程

---

## 为什么不继续扩展 Intent Request

当前 `Intent Request` 更适合承担:

- workflow 控制
- Runtime 内部动作
- `FOLLOW_UP` 派生
- memory / skill 这类运行时编排请求

不适合承担:

- `read`
- `ls`
- `tree`
- `ripgrep`
- `write`
- `bash`
- `git`

这类“真实工具调用”。

原因是:

1. 工具调用本质上是模型执行期的多步交互,不是单纯的 workflow 请求
2. 如果把每个工具都扩展成 `Intent Request`,会把协议层迅速做大
3. 这会让 `Runtime` 重新变成一个混合协议解析器和工具执行器
4. 也会让 `Transport` 无法承接模型原生 tool calling 的优势

因此这里保持明确边界:

- `Intent Request` 继续负责 workflow 控制
- `tool calling` 负责同一轮模型执行里的多步工具交互

---

## 多轮工具调用的定义

Tools 这里需要区分两种“多轮”:

### 1. 单轮 conversation 内的多步工具调用

这是指同一次正式对话请求中:

```text
model -> tool A -> model -> tool B -> model -> final answer
```

这一层应当由 `Transport` 承载。

它不是 `FOLLOW_UP`,而是同一轮模型执行中的 tool loop。

### 2. 跨 task 的连续工具调用

这是指某一轮回答没有完成,系统派生 `FOLLOW_UP` 后:

```text
round 1 tool summary
-> Runtime context
-> FOLLOW_UP
-> round 2 continue with tools
```

这一层应当由:

- `Runtime` 保存工具结果摘要
- `Queue` 派生内部任务
- `FOLLOW_UP` 继续消费上下文

---

## 推荐工作链路

Tools 落地后的默认链路应为:

```text
Queue
-> Runtime
-> Transport(with tools)
-> ToolService execute
-> Transport continue
-> Runtime summarize tool results
-> Runtime decide complete or follow up
-> Queue
```

更具体地说:

### external task

```text
External User Task
-> Queue
-> Runtime prepare prompts
-> Runtime create tool execution context
-> Runtime create tool registry
-> Transport send with tools
-> ToolService execute tool calls
-> Runtime summarize tool results
-> Runtime parse intent requests
-> Runtime decide complete or follow up
-> Queue
```

### follow-up task

```text
FollowUp Task
-> Queue
-> Runtime reuse conversation/tool context
-> Runtime create tool registry
-> Transport send with tools
-> ToolService execute tool calls
-> Runtime update tool summary
-> Runtime decide complete or continue follow up
-> Queue
```

---

## 推荐目录结构

```text
src/services/tools/
  index.ts
  tool-service.ts
  registry/
    index.ts
    factories.ts
    output-wrapper.ts
  permissions/
    index.ts
    policy.ts
  types.ts
  read.ts
  ls.ts
  tree.ts
  ripgrep.ts
  write.ts
  bash.ts
  git.ts
```

说明:

- `ToolService` 是唯一对外服务入口
- `registry/` 负责工具注册与包装
- `permissions/` 负责权限边界
- 各工具文件只关注单一工具实现

---

## ToolService 对外边界

`ToolService` 对外应只暴露高层能力,例如:

- 创建内置工具 registry
- 基于当前 task 创建工具执行上下文
- 提供工具执行策略

不推荐对外暴露:

- `getToolRegistryManager()`
- `getPermissionPolicy()`
- `getBuiltinTools()`

这种继续透传内部对象的方法。

默认约束:

- workflow 通过 `Runtime` 获取可用工具
- `Runtime` 通过 `ToolService` 获取 registry
- `ToolService` 内部实现细节不直接外泄

---

## Tool Execution Context

每次正式对话执行时,都需要生成一份与当前 task 绑定的 `ToolExecutionContext`。

它至少应包含:

- workspace
- 当前 task 的 session/chat 绑定信息
- 权限配置
- 工具预算
- 执行前 guard
- 执行后 settled hook
- 输出观测 sink

这里的重点不是“让工具知道 Runtime”,而是让工具执行具备受控上下文。

因此:

- `ToolExecutionContext` 可以带 task identity
- 但不能直接暴露 `Runtime` 内部对象
- 更不能把 `ContextManager` 或 `TaskQueue` 传给工具实现

---

## 工具观测与上下文摘要

Tools 落地后,运行时上下文需要新增一块轻量的工具摘要上下文。

推荐内容:

- tool name
- input summary
- output summary
- ok / error
- timestamp

不推荐:

- 直接把完整 stdout / stderr 全量塞进 prompt
- 把大文件内容原样写入上下文
- 无限累积全部历史工具输出

原因是:

- 工具结果需要被后续对话看到
- 但 prompt token 预算不能被工具原始输出吞掉

因此默认做法应当是:

- 工具原始结果只用于当前轮执行
- `Runtime` 只保存摘要进入后续上下文

---

## 工具权限边界

第一版 Tools 必须带权限系统。

至少需要约束:

- 可读路径范围
- 可写路径范围
- 命令执行范围
- Git 操作范围
- 网络访问范围

这套权限边界属于 `ToolService`,不属于 `Runtime`。

`Runtime` 只负责:

- 选择是否给当前轮开放某些工具
- 在高层策略上决定预算和 guard

具体路径和命令是否合法,仍由工具权限策略判断。

---

## 工具预算与停止条件

为了支持多步工具调用但避免无限循环,系统需要同时具备两层约束:

### 单轮工具步数限制

用于约束同一次 conversation 内:

- 最多允许多少次 tool step
- 超限后直接停止并返回错误或结束当前轮

### follow-up 轮数限制

用于约束整个 chat 内:

- 最多允许多少次内部续跑
- 超限后不再继续派生 `FOLLOW_UP`

这两层限制不能混用。

也就是说:

- `maxToolSteps` 约束的是单轮工具循环
- `maxFollowUpRounds` 约束的是跨任务续跑

---

## 第一阶段工具范围

为了遵守“小步快行”,`0.12` 第一阶段只建议正式落地只读和低风险工具:

- `read`
- `ls`
- `tree`
- `ripgrep`

第二阶段再补:

- `write`
- `cp`
- `mv`

第三阶段再补:

- `bash`
- `git`

这样做的原因是:

- 先验证工具链路本身
- 再扩大写操作风险面
- 最后才开放高风险执行能力

---

## 与 atom 项目的关系

`/Volumes/Projects/atom` 在这里的作用是参考实现。

当前项目吸收的是它的设计经验:

- 独立工具 registry
- 工具执行上下文
- 统一 wrapper
- 原生 tool calling 接入
- 工具输出观测

但 `atom_next` 不应直接复制 `atom` 的全部实现,原因是:

- 当前 `atom_next` 仍然保留自己的 `Queue -> Runtime -> Transport -> Runtime` 主链路
- 当前 `Intent Request` 和 `FOLLOW_UP` 已经形成自己的 workflow 形态
- 需要基于现有代码边界做增量落地,而不是把 agent 架构整体替换过来

---

## 默认实现约束

`0.12` 的 Tools 落地应遵守下面几条默认约束:

1. `ToolService` 是独立基础服务,不写成 `Runtime` 子模块
2. workflow 只依赖 `Runtime`,不直接依赖 tools 内部实现
3. `Transport` 只承载模型与 tool calling 通信,不持有工具业务状态
4. `Queue` 不感知工具
5. `Intent Request` 不扩展为通用工具协议
6. 工具结果进入 `Runtime` 时只保留摘要,不保留无限原始输出
7. 首版先落地低风险工具,后续再逐步扩展

---

## 文档关系

为了避免本文件同时承担“设计文档”和“开发计划”的职责,`0.12` 相关内容拆分如下:

- Tools 设计说明:
  - [docs/tools.md](/Volumes/Projects/atom_next/docs/tools.md)

- `0.12` 开发计划:
  - [docs/plans/PLAN_0.12.md](/Volumes/Projects/atom_next/docs/plans/PLAN_0.12.md)

- `0.12` 里程碑说明:
  - [docs/milestones/0.12.md](/Volumes/Projects/atom_next/docs/milestones/0.12.md)
