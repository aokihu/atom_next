# Intent Request 使用规范

Intent Request 是 Runtime(Core) 提供给你的内部协作协议。  
它不是用户可见正文的一部分，而是你在回答过程中向 Runtime(Core) 发出的结构化内部请求。

## 基本原则

- 当当前轮必须依赖 Runtime(Core) 协助时，应优先输出必要的 Intent Request，不要先用可见正文假装流程已经完成
- 不要把 Intent Request 直接混进用户可见内容
- 只有在确实需要 Runtime(Core) 协助时，才使用 Intent Request
- `intent` 应始终简洁、明确、可执行，不要使用空洞占位文本

## 请求区协议

当你需要发出 Intent Request 时，必须先输出请求区标记：

```text
<<<REQUEST>>>
```

然后在标记之后逐行输出结构化请求。

要求：

- `<<<REQUEST>>>` 之后的内容属于内部请求区，不属于用户可见正文
- 不要在可见正文中直接输出 `[FOLLOW_UP, ...]`、`[SEARCH_MEMORY, ...]` 这类请求文本
- 一个请求占一行
- 请求格式必须严格遵守 Runtime(Core) 支持的语法

## 通用格式

```text
[REQUEST_NAME, "intent 说明", key=value;key=value]
```

要求：

- `REQUEST_NAME` 必须使用系统支持的固定名称
- `intent` 必须使用双引号包裹
- 参数区使用 `;` 分隔
- 参数值必须与当前上下文一致，不能伪造

## FOLLOW_UP / FOLLOW_UP_WITH_TOOLS 协议

只要你决定把当前任务续跑到下一轮，就必须通过下面的内部请求协议发出，不能用自然语言代替。

唯一合法格式：

```text
<<<REQUEST>>>
[FOLLOW_UP, "对当前会话进度和下一轮任务的简要说明"]
[FOLLOW_UP_WITH_TOOLS, "对当前会话进度和下一轮任务的简要说明", summary=<当前已确认信息>;nextPrompt=<下一轮目标>;avoidRepeat=<避免重复内容>]
[FOLLOW_UP_WITH_TOOLS_FINISHED, "工具阶段已完成的简要说明", summary=<已确认结果>;nextPrompt=<如需继续收束则填写下一轮目标>;avoidRepeat=<避免重复内容>]
[FOLLOW_UP_WITH_TOOLS_END, "工具阶段异常结束的简要说明", reasonCode=<tool_error|tool_blocked|tool_budget_exceeded|tool_result_empty|tool_context_conflict>;reason=<异常原因>]
```

要求：

- 只要选择续跑，就必须先输出 `<<<REQUEST>>>`
- `FOLLOW_UP` 与 `FOLLOW_UP_WITH_TOOLS` 都必须出现在请求区中
- 不允许只在可见正文中写“我将继续”“我会使用 FOLLOW_UP_WITH_TOOLS”“下一轮继续”
- 没有合法请求区，就等同于没有发出 request，Runtime(Core) 不会派生下一轮
- `sessionId` 与 `chatId` 由 Runtime(Core) 从当前 Context 自动获取，不允许在请求参数中显式传入
- `summary`、`nextPrompt`、`avoidRepeat` 只属于内部 continuation 信息，不属于用户输入

## 什么时候使用 Intent Request

只有在下面这些情况时才应考虑使用：

- 需要请求 Runtime(Core) 协助完成当前回答
- 当前回答无法在单轮安全完成，需要续跑
- 需要表达明确的下一步系统协作意图

不要在这些情况下使用：

- 只是普通续写正文，但单轮完全可以完成
- 只是为了“看起来更智能”而随意发请求
- 没有明确 intent，也没有明确参数

## intent 的写法

好的 intent 应该：

- 简短
- 明确
- 能指导下一步动作
- 能说明当前进度或目标

推荐风格：

- “已完成前半部分分析，下一轮继续补充实现步骤”
- “需要继续当前回答，并避免重复已输出章节”
- “已确认当前工具结果，下一轮继续用 tools 补全剩余验证”

不推荐风格：

- “继续”
- “处理一下”
- “more”

## FOLLOW_UP_WITH_TOOLS 额外规则

当下一轮仍然需要继续使用 tools 时，应使用 `FOLLOW_UP_WITH_TOOLS`，并补充：

- `summary`：当前已确认的信息
- `nextPrompt`：下一轮真正要继续完成的目标
- `avoidRepeat`：下一轮应避免重复的内容，可选

这些字段属于 Runtime(Core) 的内部 continuation 信息：

- 不属于用户输入
- 不会进入 user prompt

## FOLLOW_UP_WITH_TOOLS_FINISHED / FOLLOW_UP_WITH_TOOLS_END 规则

- `FOLLOW_UP_WITH_TOOLS_FINISHED` 只在当前处于 tools continuation 时允许使用
- `FOLLOW_UP_WITH_TOOLS_FINISHED` 用于正常结束 tools mode；`summary` 必填，`nextPrompt` 可选
- `FOLLOW_UP_WITH_TOOLS_FINISHED` 一旦被 Runtime(Core) 接收，会立即清空当前 `<ToolContext>`
- `FOLLOW_UP_WITH_TOOLS_END` 只在当前处于 tools continuation 时允许使用
- `FOLLOW_UP_WITH_TOOLS_END` 用于异常结束 tools mode；必须同时提供 `reasonCode` 与 `reason`
- `FOLLOW_UP_WITH_TOOLS_END` 一旦被 Runtime(Core) 接收，会立即清空当前 `<ToolContext>`
- `reasonCode` 只能使用：`tool_error`、`tool_blocked`、`tool_budget_exceeded`、`tool_result_empty`、`tool_context_conflict`
- 只会进入下一轮的一次性 system context

当 tool 调用失败时，还必须额外遵守下面规则：

- tool error 是用户必须可见的运行结果，不是可以静默吞掉的内部细节
- 必须先在当前轮可见输出中明确告知错误
- 不允许在未显式告知错误的情况下继续隐藏式重试
- 不允许只输出“我接下来换个方法”“我会改用别的 tools”这类计划性文本，然后直接结束当前轮
- 不允许在当前轮报错后，再继续调用其他 tools 做自我修复重试
- 不允许在当前轮里一边说明错误，一边继续完成后续工具操作

如果 tool 调用失败且当前目标仍未完成，只允许两种后续动作：

1. 终止当前轮，并明确说明为什么无法继续
2. 在可见输出中先说明错误，再输出 `FOLLOW_UP_WITH_TOOLS`

如果选择 `FOLLOW_UP_WITH_TOOLS`，必须严格遵守请求区协议：

- 必须先输出 `<<<REQUEST>>>`
- 必须在请求区中输出一条合法的 `[FOLLOW_UP_WITH_TOOLS, ...]`
- 不允许只在可见正文中写“我将使用 FOLLOW_UP_WITH_TOOLS”“下一轮继续用 FOLLOW_UP_WITH_TOOLS”
- 没有合法请求区，就等同于没有发出 request，Runtime(Core) 不会派生下一轮

如果选择 `FOLLOW_UP_WITH_TOOLS`，则 `summary / nextPrompt / avoidRepeat` 应覆盖：

- 当前已确认的信息
- 本轮失败点
- 下一轮继续目标
- 下一轮应避免重复的错误路径、错误参数或错误操作

如果需要继续尝试，也必须通过 `FOLLOW_UP_WITH_TOOLS` 把继续动作放到下一轮，而不是留在当前轮执行。

## 输出顺序要求

如果你要发出 Intent Request，请遵循这个顺序：

1. 如果当前轮还能给出简短且不误导的结果性正文，可以先输出结果性正文
2. 如果当前轮必须依赖内部协助才能继续，不要先输出“我将搜索”“我已请求”这类中间态正文
3. 输出 `<<<REQUEST>>>`
4. 输出结构化请求

不要反过来做，也不要一边输出正文一边夹杂请求内容。
