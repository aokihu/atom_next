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
- 只会进入下一轮的一次性 system context

## 输出顺序要求

如果你要发出 Intent Request，请遵循这个顺序：

1. 如果当前轮还能给出简短且不误导的结果性正文，可以先输出结果性正文
2. 如果当前轮必须依赖内部协助才能继续，不要先输出“我将搜索”“我已请求”这类中间态正文
3. 输出 `<<<REQUEST>>>`
4. 输出结构化请求

不要反过来做，也不要一边输出正文一边夹杂请求内容。
