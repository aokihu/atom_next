# PLAN 0.12 Runtime Tools Integration

## 目标

把当前已经落地的 `ToolService` 和 `Transport` tools 能力，正式接入 `Queue -> Runtime -> Transport -> Runtime` 主链路。

这一阶段只解决正式对话主链路上的 tools 对接问题，不继续扩展新工具类型，也不新增工具 UI。

---

## 当前状态

当前已经具备:

- 独立 `ToolService`
- 只读四件套工具: `read / ls / tree / ripgrep`
- 工具权限、budget、guard、settled hook
- `Transport.send()` 支持:
  - `tools`
  - `maxToolSteps`
  - `onToolCallStart`
  - `onToolCallFinish`
  - 单轮 tool loop

当前仍然缺少:

- `Runtime` 对 tools 的高层编排入口
- 工具结果摘要上下文
- prompt 中的工具摘要块
- formal conversation workflow 对 tools 的正式接线
- `FOLLOW_UP` 对工具摘要的续跑消费

---

## 实现目标

本计划完成后，系统应达到下面状态:

- `Runtime` 成为 tools 的唯一运行时编排入口
- formal conversation 会向 `Transport` 注入当前轮可用 tools
- 工具执行结果会沉淀为轻量摘要进入 `Runtime` context
- 后续 `FOLLOW_UP` 可以继续消费这些摘要

本阶段明确不做:

- `write / cp / mv`
- `bash / git`
- MCP / plugin / market
- TUI 工具事件展示
- 新的 `Intent Request` 工具协议

---

## 关键改动

### 1. Runtime 增加 tools 高层动作

`Runtime` 只新增高层动作，不向 workflow 暴露 `ToolService` 本体:

- `createToolExecutionContext()`
- `createConversationToolRegistry()`
- `recordToolExecutionSettled()`

约束:

- workflow 只能通过 `Runtime` 使用 tools
- `Runtime` 内部通过 `resolveToolService(...)` 访问 service
- `ToolService` 仍然保持独立，不反向依赖 `Runtime`

### 2. Runtime 建立工具摘要上下文

在 `Runtime` 当前 chat / follow-up 链路上下文中增加 `tools` 摘要状态，固定字段为:

- `toolName`
- `inputSummary`
- `outputSummary`
- `ok`
- `errorMessage`
- `updatedAt`

默认规则:

- 只保留最近 `5` 条摘要
- 同一 chat 的 internal follow-up 继续保留
- 新 external chat 到来时清空
- 不把完整工具原始输出长期存入 context

### 3. Prompt 子域接入 `<Tools>`

`RuntimePromptContextSnapshot` 增加 `tools` 字段。

prompt 子域新增 `<Tools>` 渲染块，位置与当前 `Conversation / Memory / FollowUp` 结构一致，原则如下:

- 无工具摘要时输出空块
- 有摘要时逐条输出结构化摘要
- 只输出摘要，不输出完整原始工具结果

### 4. formal conversation workflow 接入 tools

只改 formal conversation workflow 的 `sendConversation()` 这一步:

- 先通过 `Runtime` 创建当前轮 tool execution context
- 再通过 `Runtime` 创建当前轮 tool registry
- 然后把 `tools` 传给 `transport.send()`
- `onTextDelta` 保持现状

工具摘要写入方式:

- 通过 `ToolService` 的 `onToolExecutionSettled` 闭包回流到 `Runtime`
- 本阶段不把 `Transport.onToolCallStart/Finish` 连接到用户可见事件

### 5. FOLLOW_UP 续跑边界

本阶段不改 `Queue` 职责。

续跑依赖当前已有机制:

- 工具摘要先进入 `Runtime` context
- internal `FOLLOW_UP` 继续读取当前 chat / follow-up context
- 不通过 memory service 持久化工具摘要

---

## 测试计划

### Runtime 单测

- `createToolExecutionContext()` 能从当前运行态拿到 workspace
- `createConversationToolRegistry()` 返回当前轮 builtin tools
- `recordToolExecutionSettled()` 能写入工具摘要
- internal follow-up 保留工具摘要
- 新 external task 到来时清空工具摘要
- system prompt 能渲染 `<Tools>`

### Workflow 单测

- formal conversation 会把 runtime 产出的 `tools` 传给 `transport.send()`
- 有 tools 时仍保持当前文本流和状态推进行为
- tool loop 不污染 `visibleTextBuffer`
- `intentRequestText` 仍只来自文本输出

### 回归范围

- 现有 `ToolService` 服务层测试继续通过
- 现有 `Transport` tools 测试继续通过
- 现有 `Runtime` 非 tools 行为不回退

---

## 默认约束

- 本计划只覆盖 `Runtime + formal conversation workflow` 的 tools 对接
- 继续遵守 `Queue -> Runtime -> Transport -> Runtime` 主链路
- `Runtime` 是对外唯一入口，workflow 不直接 import `ToolService`
- 工具摘要默认上限为 `5`，与当前 `Transport` 默认 `maxToolSteps=5` 对齐
- 本阶段不暴露用户可见 tool event，不修改 `Intent Request` 协议
