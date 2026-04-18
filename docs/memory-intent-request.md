# Memory Intent Request 微型文档

## 文档目的

本文件用于把当前 `Intent Request` 体系与 `MemoryService` 设计放到同一页上说明,并整理两者之间还没有对齐的问题。  
它不是里程碑文档,也不是实施计划文档,而是一份面向讨论和继续设计的微型说明。

相关文档:

- [docs/memory.md](/Volumes/Projects/atom_next/docs/memory.md)
- [docs/milestones/0.10.md](/Volumes/Projects/atom_next/docs/milestones/0.10.md)
- [PLAN_0.10.md](/Volumes/Projects/atom_next/PLAN_0.10.md)

---

## 当前 `Intent Request`

当前系统中与记忆相关的 `Intent Request` 只有两类,定义见 [src/types/intent-request.ts](/Volumes/Projects/atom_next/src/types/intent-request.ts):

### `SEARCH_MEMORY`

当前代码中的参数结构:

```ts
type SearchMemoryIntentRequestParams = {
  words: string;
  limit?: number;
  scope?: "core" | "short" | "long";
};
```

当前语义:

- 根据关键词搜索记忆
- `scope` 为空时,当前设计按 `long` 处理
- 当前只完成了解析与安全检查,还没有真实搜索实现

### `SAVE_MEMORY`

当前代码中的参数结构:

```ts
type SaveMemoryIntentRequestParams = {
  text: string;
  summary?: string;
  scope?: "core" | "short" | "long";
};
```

当前代码中的真实状态:

- 只支持 `text` / `summary` / `scope`
- 解析逻辑位于 [src/core/runtime/intent-request.ts](/Volumes/Projects/atom_next/src/core/runtime/intent-request.ts)
- 安全检查目前只校验 `text` 长度,见 [src/core/runtime/intent-request-safety/save-memory.ts](/Volumes/Projects/atom_next/src/core/runtime/intent-request-safety/save-memory.ts)
- 分发仍然是占位实现,没有接到真实 `MemoryService`

---

## 当前记忆系统设计

当前记忆系统的设计说明见 [docs/memory.md](/Volumes/Projects/atom_next/docs/memory.md),可以收口成下面几条:

### 1.职责边界

- `MemoryService` 负责记忆本身
- `Core` 负责调用时机
- `Runtime` 负责把 Memory 结果放进上下文

### 2.存储模型

记忆系统不是简单字符串列表,而是图结构:

- `memory_nodes`
- `link_nodes`
- `memory_events`

其中:

- `MemoryNode` 保存记忆主体
- `LinkNode` 保存 `source -> target` 的有向边
- `MemoryEvent` 保存审计事件

### 3.`MemoryNode`

当前设计中的核心字段包括:

- `id`
- `memory_key`
- `scope`
- `type`
- `summary`
- `text`
- `confidence`
- `importance`
- `source`
- `source_ref`
- `status`
- `status_reason`
- `superseded_by_memory_id`

### 4.`LinkNode`

当前设计中的核心字段包括:

- `id`
- `source_memory_id`
- `source_memory_key`
- `target_memory_id`
- `target_memory_key`
- `link_type`
- `term`
- `weight`
- `score`

### 5.默认运行时输出

当前默认输出不是完整图查询结果,而是给 `Runtime(Core)` 组装上下文使用:

- 一条完整 `memory`
- 一层 `links`

默认输出会刻意隐藏内部字段,例如:

- `memory.id`
- `memory.summary`
- `links[].id`
- `links[].target_memory_id`

---

## 当前建议下的 `SAVE_MEMORY` 目标语义

虽然代码里的 `SAVE_MEMORY` 还比较简单,但当前设计文档已经把它收口成更完整的保存语义。

目标上,`SAVE_MEMORY` 应该具备:

- `text`
- `summary`(可选)
- `suggested_key`(可选)
- `links`(可选)
- `scope`(可选)
- `type`(可选)

设计含义如下:

- `text` 是记忆正文
- `summary` 可由 LLM 提供,也可以由系统补全
- `suggested_key` 由 LLM 提供,用于表达记忆的语义命名建议
- `links` 由 LLM 提供,用于表达当前记忆应如何挂接到已有记忆图
- `scope` 用于标识 `core` / `short` / `long`
- `type` 用于标识记忆语义类型

这里需要明确区分:

- `suggested_key`
  - LLM 提供的语义命名建议
- `memory_key`
  - `MemoryService` 规范化、唯一化后最终写入数据库的业务标识

### 新记忆的默认连接规则

当前已经确定的规则是:

- 新记忆通常指向上一级记忆
- 如果上一级记忆是根记忆,则 `parent_memory_key` 使用保留值 `"root"`
- 如果上一级记忆不是根记忆,则 `links` 引用该上一级记忆的 `parent_memory_key`

也就是说:

- `SAVE_MEMORY.links` 不直接使用数据库内部主键
- `parent_memory_key` 是 LLM 和 Runtime 可见的语义标识
- `MemoryService` 在内部把 `parent_memory_key` 解析为真实 `memory.id`
- `"root"` 是虚拟根节点标识,不对应实际数据库记录

推荐的输入结构是:

```ts
type SaveMemoryIntentRequestParams = {
  text: string;
  summary?: string;
  suggested_key?: string;
  links?: SaveMemoryLinkInput[];
  scope?: "core" | "short" | "long";
  type?: MemoryType;
};

type SaveMemoryLinkInput = {
  parent_memory_key: string | "root";
  link_type: LinkType;
  term: string;
  weight?: number;
};
```

---

## `Intent Request` 与记忆系统如何连接

当前合理的连接方式应该是:

1. LLM 生成 `SEARCH_MEMORY` 或 `SAVE_MEMORY`
2. `Runtime` 解析 `Intent Request`
3. `Core` 串行消费安全通过的请求
4. `Core` 调用 `MemoryService`
5. `MemoryService` 完成真实读写
6. `Runtime` 接收 Memory 结果并组装到 `<Memory>` Context

其中:

- `SEARCH_MEMORY` 更接近“检索入口”
- `SAVE_MEMORY` 更接近“写入入口”
- `retrieveRuntimeContext()` 更接近“给 Runtime 的上层上下文组装能力”

---

## 当前还没有对齐的问题

下面这些问题是当前最需要继续收口的部分。

### 1. `SAVE_MEMORY` 的代码契约落后于设计契约

当前代码里 `SAVE_MEMORY` 只有:

- `text`
- `summary?`
- `scope?`

但当前设计里 `SAVE_MEMORY` 已经需要:

- `text`
- `summary?`
- `suggested_key?`
- `links?`
- `scope?`
- `type?`

这是当前最直接的契约冲突。

### 2. `SAVE_MEMORY.links` 的业务标识结构还没有进入代码层

当前设计已经收口成:

- `parent_memory_key`
- `"root"`

也就是说数据库内部 `memory.id` 已经不应该进入 `Intent Request`。  
但当前这套 links 输入结构还没有真的进入类型系统和解析器。

### 3. `SEARCH_MEMORY` / `SAVE_MEMORY` 仍然没有真实分发实现

当前代码里:

- `SEARCH_MEMORY dispatch is reserved but not implemented yet`
- `SAVE_MEMORY dispatch is reserved but not implemented yet`

也就是说:

- 协议入口存在
- 解析和安全检查存在
- 真实记忆动作还不存在

### 4. `MemoryService` 仍然停留在设计文档层

当前还没有真正落地:

- `MemoryService`
- sqlite schema 初始化
- `memory_nodes` / `link_nodes` / `memory_events`
- `searchMemory`
- `saveMemory`
- `getRelatedMemories`
- `retrieveRuntimeContext`

### 5. 保存前最小去重与冲突判断还没有代码层定义

设计文档里已经确定:

- `create`
- `update_existing`
- `link_existing`
- `mark_conflict`
- `skip_duplicate`

但当前代码层还没有:

- 对应的类型定义
- 对应的返回结构
- 对应的实现位置

### 6. `SAVE_MEMORY.links` 与 `suggested_key` 还没有固定到类型层

现在虽然已经明确:

- `suggested_key` 由 LLM 提供
- `links` 需要由 LLM 提供
- 新记忆默认连接到上一级
- 根父节点保留值为 `"root"`

但还没有正式写成类型定义,例如:

```ts
type SaveMemoryIntentRequestParams = {
  text: string;
  summary?: string;
  suggested_key?: string;
  links?: SaveMemoryLinkInput[];
  scope?: "core" | "short" | "long";
  type?: MemoryType;
};

type SaveMemoryLinkInput = {
  parent_memory_key: string | "root";
  link_type: LinkType;
  term: string;
  weight?: number;
};
```

当前这部分还只是文档语义,没有进入代码。

### 7. `memory_key` 的最终生成规则还没有进入代码层

当前建议已经很明确:

- LLM 只提供 `suggested_key`
- `MemoryService` 负责规范化、唯一化和最终 `memory_key` 生成

但当前代码层还没有:

- `normalizeMemoryKey`
- 冲突时追加 short hash 的规则
- `SaveMemoryResult.memory_key`

### 8. `summary` 的生成责任还没有彻底定死

当前文档允许:

- LLM 提供 `summary`
- 系统自动补全 `summary`

这个方向没有问题,但还缺少一个更细的规则:

- 哪些情况下必须接受 LLM 提供的 `summary`
- 哪些情况下需要系统重写或校正 `summary`

如果后面不补这条规则,`summary` 的一致性可能会比较差。

### 9. `retrieveRuntimeContext()` 和默认输出的关系还没有完全落到接口层

当前已经明确:

- `searchMemory()` 是底层搜索
- `retrieveRuntimeContext()` 是面向 `Runtime` 的上层能力

但代码层仍然没有这个接口,所以还没法把:

- 检索结果
- 默认 `memory + links` 输出
- `<Memory>` 上下文组装

彻底接成闭环。

---

## 当前最值得优先解决的问题

如果只按优先级排最关键的几件事,当前建议是:

1. 先统一 `SAVE_MEMORY` 的输入契约
2. 再把 `parent_memory_key | "root"` 正式纳入类型与解析器
3. 再把 `MemoryService` 的最小接口落地
4. 再落地 `memory_key` 的规范化与唯一化
5. 最后再接 `SEARCH_MEMORY` / `SAVE_MEMORY` 的真实分发

原因很简单:

- 不先统一 `SAVE_MEMORY` 契约,后面的代码都会反复改
- 不先解决 `parent_memory_key` 的输入结构,`links` 设计就没法真正落地
- 不先落地 `MemoryService`,协议永远只是占位入口

---

## 一句话结论

当前项目已经把“记忆系统应该长成什么样”大体讲清楚了,但还没有把“`Intent Request` 如何稳定地把数据送进这套记忆系统”完全对齐。

现在最核心的问题不是继续扩展设计,而是把 `SAVE_MEMORY` 的输入契约、`suggested_key -> memory_key` 的生成规则、`parent_memory_key -> memory.id` 的内部解析规则和 `MemoryService` 的最小实现边界统一下来。
