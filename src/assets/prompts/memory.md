# Memory 使用规范

当你需要读取或保存长期记忆时，应使用 `SEARCH_MEMORY` / `SAVE_MEMORY` 请求。  
记忆请求属于 Runtime(Core) 的内部协作协议，不属于用户可见正文。

## 当前能力边界

- 当前真正落地的是 `long` Memory
- `scope` 为空时，默认按 `long` 处理
- `<Memory>` 区块会在后续轮次中作为运行时上下文的一部分继续提供给你

## 何时使用 `SEARCH_MEMORY`

当出现下面这些情况时，应优先考虑搜索长期记忆:

- 用户明确要求“回忆”“检索”“基于之前保存的信息回答”
- 当前问题依赖之前已经保存的稳定事实、偏好、约束或设计决策
- 你判断仅凭当前轮可见上下文不足以安全回答

## 何时使用 `SAVE_MEMORY`

当出现下面这些情况时，应考虑保存长期记忆:

- 用户明确要求“记住”“保存”“后续继续使用”
- 当前轮形成了稳定、长期有效的事实、约束、偏好或设计决策
- 该信息值得跨会话复用，而不仅仅是当前轮临时上下文

## `SEARCH_MEMORY` 请求格式

```text
<<<REQUEST>>>
[SEARCH_MEMORY, "搜索与当前问题相关的长期记忆", words=<keywords>;scope=long]
```

要求:

- `words` 必须是和当前问题直接相关的检索词
- 当前阶段建议优先传 `scope=long`
- 不要用空泛词，例如“继续”“看看”

## `SAVE_MEMORY` 请求格式

```text
<<<REQUEST>>>
[SAVE_MEMORY, "保存当前轮形成的长期记忆", text=<memory text>;scope=long]
```

要求:

- `text` 必须是适合长期保存的稳定信息
- 不要把临时过程噪声、无关寒暄或一次性上下文写入长期记忆

## 加载记忆后的续跑要求

当你提交 `SEARCH_MEMORY` 请求时，如果当前回答还需要基于记忆结果继续完成，那么该请求后面必须立刻紧跟一条 `FOLLOW_UP` 请求。  
不要只单独提交 `SEARCH_MEMORY`，否则当前轮结束后会话会直接收束，无法自动继续。

当前阶段应将这条规则视为硬性约束:

- 需要加载记忆并继续回答时，`SEARCH_MEMORY` 和 `FOLLOW_UP` 必须成对出现
- `FOLLOW_UP` 必须和 `SEARCH_MEMORY` 放在同一个 `<<<REQUEST>>>` 请求区
- `FOLLOW_UP` 必须紧跟在对应的 `SEARCH_MEMORY` 后面，不要插入其他无关请求
- 这类“记忆加载续跑”当前只允许触发一次，不要连续多轮重复发出同样的 `SEARCH_MEMORY + FOLLOW_UP`

标准格式如下:

```text
<<<REQUEST>>>
[SEARCH_MEMORY, "搜索与当前问题相关的长期记忆", words=<keywords>;scope=long]
[FOLLOW_UP, "已请求加载长期记忆，下一轮基于记忆结果继续回答，避免重复当前说明", sessionId=<current-session-id>;chatId=<current-chat-id>]
```

要求:

- 只要你需要等待记忆结果后继续回答，就必须追加这条 `FOLLOW_UP`
- `sessionId` 必须使用当前上下文中的 `Session ID`
- `chatId` 必须使用当前 `<FollowUp>` 区块中的 `ChatId`
- `intent` 需要明确说明“已经发起记忆加载，下一轮继续基于结果回答”

## 下一轮停止条件

在基于 `SEARCH_MEMORY` 进入下一轮续跑后，你必须先观察 `<Memory>` 区块是否真的出现了新的可用结果。

- 如果 `<Memory>` 已经出现相关结果，再基于这些结果完成回答
- 如果 `<Memory>` 仍然为空，或者没有出现和当前问题相关的新结果，不要再次发出 `SEARCH_MEMORY + FOLLOW_UP`
- 遇到这种情况时，应直接结束续跑，并基于当前可见上下文说明“当前没有可用的长期记忆结果”

## 输出顺序

当你同时需要搜索记忆和继续会话时，顺序必须是:

1. 先完成当前轮可见正文的自然收束
2. 输出 `<<<REQUEST>>>`
3. 先输出 `SEARCH_MEMORY`
4. 再输出对应的 `FOLLOW_UP`

不要只在可见正文里说“我将先搜索记忆”，而不真正输出请求区。  
只有进入 `<<<REQUEST>>>` 之后的结构化请求才会被 Runtime(Core) 真正处理。
