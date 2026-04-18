# Memory Service

## 文档目的

本文件用于说明 `atom_next` 系统内 `MemoryService` 的设计边界、存储方式、数据结构和默认输出格式。  
它是 `0.10` 里程碑对应的 Memory 说明文档,不承担实现步骤拆解职责。

---

## 为什么需要独立的 `MemoryService`

`MemoryService` 是系统内部基础服务,不是外部依赖包装层。

它存在的意义是:

- 让长期记忆成为系统内正式能力
- 为 `Runtime(Core)` 提供稳定的记忆读写与检索入口
- 把 Memory 的存储、连接、检索与输出组织收口在单一职责边界中

`/Volumes/Projects/kv-memory` 在这里的作用是参考实现。  
当前项目吸收的是它的设计经验,而不是在运行时依赖另一个外部项目。

---

## 服务职责

`MemoryService` 应当负责:

- 初始化 Memory 数据库
- 管理长期记忆的写入、读取、更新与状态维护
- 管理 `MemoryNode` 与 `LinkNode`
- 提供搜索与检索能力
- 提供运行时上下文检索能力
- 提供后台维护能力
- 提供记忆审计追踪能力
- 把存储结果组织成适合 `Runtime(Core)` 消费的输出格式

`MemoryService` 不应当负责:

- 解析 `Intent Request`
- 决定 Prompt 文本如何拼接
- 直接控制 `Runtime Context` 的渲染方式

也就是说:

- `MemoryService` 负责记忆本身
- `Core` 负责调用时机
- `Runtime` 负责把 Memory 结果放进上下文

### 后台维护职责

除了基础读写能力之外,`MemoryService` 还应承担后台维护职责。

当前阶段应明确存在下面三类维护动作:

- 定时计算 `LinkNode` 的 score
- 定时整理 Memory
- 定时整合 Memory

这些动作的目的不是直接暴露给 `Runtime(Core)` 消费,而是保证长期记忆系统在持续运行后仍然保持可用、稳定和可维护。

---

## 存储方式

当前 Memory 采用 `sqlite` 持久化存储。

原因如下:

- 当前项目是本地运行系统,不需要引入额外数据库服务
- `sqlite` 足够承载当前阶段的长期记忆规模
- 它便于在系统内部直接管理 schema、索引和本地数据生命周期

---

## 存储模型

Memory 不应被视为简单字符串列表,而应视为带连接关系的图结构。  
但在存储层,图结构不是通过在 Memory 中直接内嵌 `links` 实现,而是拆成两个独立表:

- `memory_nodes`
- `link_nodes`
- `memory_events`

### `MemoryNode`

`MemoryNode` 用于保存记忆主体:

- `memory_key`
- `scope`
- `type`
- `summary`
- `text`
- `confidence`
- `importance`
- `source`
- `source_ref`
- 基础元数据与统计字段
- 生命周期状态字段

其中:

- `scope` 用于标识当前记忆属于 `core` / `short` / `long` 中的哪一类
- `type` 用于标识当前记忆的语义类型,例如 `note` / `constraint` / `decision`
- `summary` 是该记忆的标准摘要
- `text` 是完整记忆正文
- `confidence` 用于标识当前记忆的可信程度
- `source` / `source_ref` 用于记录记忆来源与来源引用
- `status` / `status_reason` / `superseded_by_memory_id` 用于支持状态流转与后续维护

### `LinkNode`

`LinkNode` 用于保存连接关系主体:

- `source_memory_id`
- `source_memory_key`
- `target_memory_id`
- `target_memory_key`
- `link_type`
- `term`
- `weight`
- `score`

`LinkNode` 本身独立存在,不再只是 `MemoryNode` 的附带属性。

这意味着:

- 连接关系可以独立读取
- 连接关系可以独立更新
- 连接关系可以独立维护
- 一条 `MemoryNode` 可以自然连接到多条相关记忆

这里不再使用 `memory_nodes.link_id` 作为头指针。  
连接关系统一由 `LinkNode(source -> target)` 表达:

1. `source_memory_id` 指向当前记忆
2. `target_memory_id` 指向目标记忆

这样才能让 `MemoryService` 真实表达记忆图结构,而不是单条记忆只挂一个引用字段。

### `MemoryEvent`

`MemoryEvent` 用于保存记忆生命周期中的审计事件:

- 创建
- 更新
- 建立连接
- 变更状态
- 合并
- 后台维护

只要 `MemoryService` 开始自动整理、整合和清理记忆,事件审计就必须存在,避免长期记忆系统变成黑箱。

---

## 固定的数据表定义

为了避免后续开发阶段继续反复修改表结构,这里固定 `MemoryService` 的基础 schema:

```sql
CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  memory_key TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  summary TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  importance REAL NOT NULL DEFAULT 0.5,
  score REAL NOT NULL DEFAULT 50,
  source TEXT NOT NULL DEFAULT 'user',
  source_ref TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  last_linked_at INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  traverse_count INTEGER NOT NULL DEFAULT 0,
  in_degree INTEGER NOT NULL DEFAULT 0,
  out_degree INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  status_reason TEXT,
  superseded_by_memory_id TEXT,
  expires_at INTEGER,
  FOREIGN KEY (superseded_by_memory_id) REFERENCES memory_nodes(id)
);

CREATE TABLE IF NOT EXISTS link_nodes (
  id TEXT PRIMARY KEY,
  source_memory_id TEXT NOT NULL,
  source_memory_key TEXT NOT NULL,
  target_memory_id TEXT NOT NULL,
  target_memory_key TEXT NOT NULL,
  link_type TEXT NOT NULL,
  term TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  score REAL NOT NULL DEFAULT 50,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_memory_id) REFERENCES memory_nodes(id),
  FOREIGN KEY (target_memory_id) REFERENCES memory_nodes(id)
);

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  memory_key TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_memory_key
ON memory_nodes(memory_key);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_scope
ON memory_nodes(scope);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_type
ON memory_nodes(type);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_status
ON memory_nodes(status);

CREATE INDEX IF NOT EXISTS idx_link_nodes_source_memory_id
ON link_nodes(source_memory_id);

CREATE INDEX IF NOT EXISTS idx_link_nodes_target_memory_id
ON link_nodes(target_memory_id);

CREATE INDEX IF NOT EXISTS idx_link_nodes_source_memory_key
ON link_nodes(source_memory_key);

CREATE INDEX IF NOT EXISTS idx_link_nodes_target_memory_key
ON link_nodes(target_memory_key);

CREATE INDEX IF NOT EXISTS idx_link_nodes_type
ON link_nodes(link_type);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory_id
ON memory_events(memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory_key
ON memory_events(memory_key);
```

这份定义固定了下面几条约束:

- `memory_nodes` / `link_nodes` / `memory_events` 是三张独立表
- `LinkNode` 用 `source_memory_id -> target_memory_id` 表达有向边
- `memory_key` 是 Memory 的业务唯一标识
- `scope` 用于标识当前记忆属于哪一类 Memory
- `type` 用于标识记忆语义类型
- `target_memory_id` 是内部稳定引用
- `target_memory_key` 是业务标识与输出辅助字段
- `source` / `source_ref` 用于保留记忆来源
- `status` 不是自由字符串,而是 Memory 生命周期状态
- `score` 是后台维护计算出的综合排序分数,不是外部直接写入的事实字段

---

## 连接语义

这里的连接有两层含义:

### 1.数据层连接

数据层连接指的是:

- `LinkNode` 保存 `source_memory_id`
- `LinkNode` 保存 `target_memory_id`
- `LinkNode` 独立表达一条从当前记忆到目标记忆的有向边

也就是说,连接关系在存储层会变成:

1. `source Memory -> LinkNode`
2. `LinkNode -> target Memory`

### 2.运行时连接

运行时连接指的是:

- `Core` 如何调用 `MemoryService`
- `Runtime` 如何接收 Memory 结果
- `FOLLOW_UP` 如何继续消费这些结果

Memory 不是孤立的数据存储,而是要进入当前对话闭环。

### `link_type` 的基础语义

当前阶段至少应固定下面几类连接语义:

- `relates_to`
- `supports`
- `conflicts_with`
- `supersedes`
- `derived_from`
- `duplicates`

这样后续在处理冲突、替代、整合和去重时,不需要重新修改连接层定义。

---

## 类型、来源与状态约束

### `type`

`type` 不等同于 `scope`.

- `scope` 负责区分 `core` / `short` / `long`
- `type` 负责区分记忆的语义用途

当前阶段建议固定下面这组基础类型:

- `note`
- `fact`
- `preference`
- `constraint`
- `decision`
- `design`
- `bug`
- `experiment`
- `procedure`
- `summary`
- `deprecated`

### `source`

`source` 用于标识记忆的来源。

当前阶段建议固定下面这组基础来源:

- `user`
- `assistant`
- `system`
- `tool`
- `file`
- `runtime_summary`
- `maintenance_merge`

### `status`

为了避免“先标记、后整理”的机制退化为自由文本,`status` 应固定为有限状态集合。

当前阶段建议固定下面这组基础状态:

- `active`
- `cold`
- `stale`
- `deprecated`
- `merged`
- `conflicted`
- `pending_delete`
- `deleted`

其中:

- `active` 表示默认可用
- `cold` / `stale` 表示进入后续维护观察区
- `deprecated` / `merged` / `conflicted` 表示不再是普通活跃记忆
- `pending_delete` / `deleted` 用于后台清理流程

`status_reason` 用于记录状态变化原因。  
`superseded_by_memory_id` 用于记录被哪条新记忆替代。

---

## 读取能力

当前 Memory 至少应具备四类读取能力:

### 1.按 key 读取

用于读取一条明确命中的 Memory.

### 2.按搜索条件读取

用于支持 `SEARCH_MEMORY`.

### 3.按关系读取

用于读取当前 Memory 的相关记忆预览。

当前阶段虽然只输出一层 `links`,但服务职责上必须允许按关系读取。

### 4.按运行时上下文读取

用于把底层搜索结果进一步整理成适合 `Runtime(Core)` 使用的上下文切片。

这里需要区分:

- `searchMemory`
  - 底层搜索能力
- `retrieveRuntimeContext`
  - 面向 `Runtime` 的上层组装能力

---

## 保存能力

当前 `SAVE_MEMORY` 请求只有:

- `text`
- `summary`(可选)
- `suggested_key`(可选)
- `links`(可选)
- `scope`
- `type`

因此当前阶段的保存语义应解释为:

- `text` 作为记忆正文
- `summary` 存在时直接使用
- `summary` 缺省时由系统自动生成标准摘要
- `suggested_key` 由 LLM 提供,用于表达记忆的语义命名意图
- `links` 由 LLM 明确提供,用于表达当前记忆与已知记忆之间的连接关系
- `scope` 用于标识记忆层级
- `type` 用于标识记忆语义类型
- 当前保存动作默认允许同时建立 `LinkNode`
- 当前保存动作在真正写入前,需要先进行最小去重与冲突检查

这里需要明确区分:

- `suggested_key`
  - 由 LLM 提供的语义命名建议
- `memory_key`
  - 由 `MemoryService` 规范化、唯一化后得到的最终业务标识

也就是说,最终写入数据库的 `memory_key` 不直接等于 LLM 原样给出的 key。  
`MemoryService` 负责:

- 规范化 `suggested_key`
- 补全 `scope` / `type` 命名空间
- 检查唯一性
- 在冲突时追加短 hash
- 返回最终 `memory_key`

### `links` 的组织约束

`SAVE_MEMORY.links` 不是任意扩散式连接,当前阶段主要用于把新记忆挂接到当前上下文中的上一级记忆。

因此默认规则应解释为:

- 新记忆通常指向上一级记忆
- 如果上一级记忆是根记忆,则 `parent_memory_key` 使用保留值 `"root"`
- 如果上一级记忆不是根记忆,则 `links` 应引用该上一级记忆的 `parent_memory_key`

这里的 `parent_memory_key` 是业务级语义标识,不是数据库内部主键。  
数据库内部 `memory.id` 只在 `MemoryService` 内部使用:

- `Runtime(Core)` 传入 `parent_memory_key`
- `MemoryService` 在保存时把 `parent_memory_key` 解析为内部 `memory.id`
- `"root"` 是 `MemoryService` 层面的虚拟根节点标识,不对应实际数据库记录

当前阶段可以把 `links` 理解为:

- 由 LLM 给出连接目标
- 由 `Runtime(Core)` 传入父级 `parent_memory_key`
- 由 `MemoryService` 在内部查询真实 `memory.id`
- 由 `MemoryService` 基于内部 `memory.id` 建立正式 `LinkNode`

推荐的输入结构应收口为:

```ts
type SaveMemoryLinkInput = {
  parent_memory_key: string | "root";
  link_type: LinkType;
  term: string;
  weight?: number;
};
```

保存前的判断流程应解释为:

1. 归一化 `text`
2. 生成或确认 `summary`
3. 规范化 `suggested_key`
4. 生成候选 `memory_key`
5. 校验 `links` 的结构完整性
6. 搜索相似 `MemoryNode`
7. 在下面几种决策中选择其一:
   - `create`
   - `update_existing`
   - `link_existing`
   - `mark_conflict`
   - `skip_duplicate`

如果当前保存动作没有明确连接信息:

- `MemoryNode` 仍然可以先独立保存
- 但这应被视为例外场景,不是默认路径

如果当前保存的是新记忆:

- 默认优先建立指向上一级记忆的连接
- 根级父节点统一用 `"root"` 作为保留值
- 后续如有需要,再追加更多 `LinkNode`

如果保存阶段已经发现高相似或冲突关系:

- 不应简单重复写入同一类记忆
- 应允许通过 `LinkNode` 建立 `duplicates` / `conflicts_with` / `supersedes` 关系
- 应把本次保存决策写入 `memory_events`

### `memory_key` 的生成规则

`memory_key` 应采用:

```text
<scope>.<type>.<semantic_slug>
```

例如:

- `long.design.memory_service_linknode_edge_model`
- `long.decision.save_memory_uses_parent_memory_key`

在没有本地大语言模型的前提下,`MemoryService` 不负责语义改写,只负责确定性处理:

- 小写化
- Unicode 规范化
- 去除危险字符
- 合并分隔符
- 限制长度
- 检查唯一性
- 冲突时追加短 hash

如果没有 `suggested_key`,则可按下面顺序派生 base key:

1. `summary`
2. `text` 前 80 字

如果 base key 已存在:

- 内容相同或高度相似时,返回 `skip_duplicate` 或 `update_existing`
- 内容不同但 key 相同时,追加短 hash 生成最终 `memory_key`

---

## 更新能力

Memory 是长期存储,因此必须允许更新。

更新至少应支持:

- 修改摘要
- 修改正文
- 修改类型、置信度、来源说明
- 修改关联 `LinkNode`
- 修改记忆状态

这里的“修改记忆状态”很重要。  
当前设计中,系统不直接对 LLM 提供“删除记忆”的能力,而是允许把记忆标记为受控生命周期状态,再交给后台维护流程处理。

这样设计的目的在于:

- 避免 LLM 因误判直接删除长期记忆
- 把高风险删除动作收口成可回看、可维护的状态流转
- 让最终清理动作由 `MemoryService` 的后台流程统一执行

当前阶段,更新能力主要首先作为 `MemoryService` 的职责边界存在,不要求全部进入 `Intent Request` 主链路。

---

## 维护能力

当前设计中,`MemoryService` 不直接对 LLM 提供“删除记忆”的能力。

这样设计的原因是:

- 长期记忆一旦被误删,恢复成本很高
- LLM 在生成删除请求时存在误判风险
- 对长期记忆来说,直接删除比状态流转风险更高

因此当前 Memory 生命周期建议采用下面这条路径:

1. 先通过更新能力把记忆标记为 `deprecated` / `pending_delete` 等状态
2. 再由 `MemoryService` 的后台维护流程统一处理

### 1.定时计算 link score

`LinkNode` 的 score 不应长期静态不变。  
`MemoryService` 需要定时重新计算连接关系的 score,用于反映当前连接的重要程度。

这一步的意义是:

- 为后续整理和整合提供排序依据
- 让长期运行后的连接关系具备动态调整能力

### 2.定时整理 Memory

整理 Memory 的目标是处理那些已经进入 `cold` / `stale` / `pending_delete` 等状态的记忆,并同步处理受影响的连接关系。

整理时至少要保证:

- 被清理的 `MemoryNode` 不再残留脏连接
- 与其相关的 `LinkNode` 被同步清理或失效处理
- 搜索与遍历不会继续读到已经应当退出主集合的记忆

### 3.定时整合 Memory

整合 Memory 的目标不是删除,而是减少长期运行后记忆系统的碎片化。

整合时更关注:

- 语义接近的记忆如何收口
- 连接关系如何合并
- 冗余记忆如何进入后续维护流程

这一步是 `MemoryService` 作为长期记忆系统的重要职责,但它的结果仍然应通过受控状态流转来落地,而不是让 LLM 直接发起高风险删除。

### 后台维护状态机

当前阶段的维护流程至少应按下面这条顺序组织:

1. `RECALCULATE_LINK_SCORE`
2. `MARK_STALE_MEMORIES`
3. `DETECT_DUPLICATES`
4. `MERGE_CANDIDATES`
5. `CLEAN_PENDING_DELETE`

这条流程的意义是:

- 先更新连接权重
- 再标记需要整理的记忆
- 再处理重复与合并候选
- 最后才进入真正的清理阶段

这样可以把高风险动作尽量放到流程末端,并保留足够的审计信息。

---

## 长期记忆范围

当前项目类型中已经存在:

- `core`
- `short`
- `long`

但当前真正落地的只有 `long`.

原因是:

- `long` 是当前阶段真正的长期持久化记忆
- `short` 更接近会话级临时上下文
- `core` 更接近系统级固定知识

当前阶段应明确:

- `long` 是本阶段唯一真正落地的 Memory 存储层
- `short` 和 `core` 只保留 Runtime 语义槽位

虽然当前真正落地的只有 `long`,但 `MemoryNode` 仍然需要保留 `scope` 字段。  
原因是:

- `scope` 是 Memory 数据本身的分类字段
- 后续扩展 `core` / `short` 时不需要重新改表
- 当前阶段即使绝大多数数据写入 `long`,存储层也应先把分类边界固定下来

---

## 长期记忆隔离方式

长期记忆不应按单个 `chatId` 隔离。

当前更合理的解释是:

- Memory 以 workspace 为主要隔离单位

这意味着:

- 同一个 workspace 下的多个会话共享长期记忆
- 不同 workspace 之间天然分离

---

## 预期目录结构

Memory 相关模块在当前项目中的预期目录边界如下:

### 1.类型层

放在 `src/types`

承担:

- `MemoryNode` 主类型
- `LinkNode` 类型
- Memory 查询结果类型
- MemoryService 对外返回类型

### 2.基础库层

放在 `src/libs`

承担:

- `sqlite` 初始化
- schema 建立
- 基础查询方法
- 搜索相关底层能力

### 3.服务层

放在 `src/services`

承担:

- `MemoryService`
- 服务生命周期管理
- 面向 `Core` 的语义化方法

### 4.运行时集成层

继续留在现有 `src/core/runtime` 和 `src/core`

承担:

- Memory 请求如何进入 `Core`
- Memory 结果如何写回 Runtime Context
- Memory 与 `FOLLOW_UP` 如何形成闭环

---

## 默认输出格式

当前 Memory 的默认输出不是通用图查询结果,而是专门提供给 `Runtime(Core)` 组装 Prompt 使用。

因此这里固定几条边界:

- 每次只返回当前命中的一条 `memory`
- 每次只返回当前 `memory` 的一层 `links`
- 当前阶段不向下递归展开更深层记忆
- `memory` 默认不输出 `summary`
- `links` 必须输出 `target_summary`

这里的设计目的很明确:

- 当前请求命中的 `memory` 本身就是本轮真正需要读取的完整记忆,因此直接给 `text`
- `links` 只承担相关记忆预览职责,用于让 LLM 判断是否继续加载下一条记忆

也就是说,当前输出语义是:

- 节点负责提供完整内容
- 连接负责提供下一跳摘要

### 默认输出结构

```ts
type MemoryOutput = {
  memory: {
    key: string;
    text: string;
    meta: {
      created_at: number;
      updated_at: number;
      score: number;
      status: string;
      confidence: number;
      type: string;
    };
  };
  retrieval: {
    mode: "key" | "search" | "relation" | "context";
    relevance: number;
    reason: string;
  };
  links: Array<{
    target_memory_key: string;
    target_summary: string;
    link_type: string;
    term: string;
    weight: number;
  }>;
};
```

### 输出规则

- `memory.summary` 不属于默认输出字段
- `memory.id` 不属于默认输出字段
- `links[].id` 不属于默认输出字段
- `links[].target_memory_id` 不属于默认输出字段
- `target_summary` 来自目标 `MemoryNode.summary`
- `target_summary` 是输出字段,不是 `link_nodes` 表中的持久化字段
- `retrieval.reason` 用于解释当前记忆为什么被取出

### 输出模式

默认输出模式是 `runtime`.

- `runtime`
  - 只输出 `Runtime(Core)` 组装上下文需要的字段
- `debug`
  - 可额外输出内部主键、统计字段、来源字段和维护信息

当前文档固定的是默认 `runtime` 输出。

### 默认不输出的内部字段

下面这些字段属于内部主键或内部统计参数,当前不应成为默认输出的一部分:

- `memory.id`
- `memory.summary`
- `links[].id`
- `links[].target_memory_id`
- `last_accessed_at`
- `last_linked_at`
- `access_count`
- `traverse_count`
- `in_degree`
- `out_degree`

---

## 为什么当前只保留一层 `links`

虽然底层 Memory 是图结构,但当前阶段不打算一次性把深层遍历一起展开。

当前只保留一层 `links` 的原因是:

- 这已经足够让 LLM 根据摘要判断下一步是否继续取记忆
- 可以显著降低 `MemoryService` 输出复杂度
- 可以避免当前阶段过早引入深层遍历、循环关系和大规模上下文膨胀

因此当前阶段的 Memory 输出更像:

- 一条完整记忆
- 加上一层相关记忆预览

而不是完整的记忆图漫游结果
