# PLAN 0.10

## 文档目的

本文件只用于拆解 `0.10` 里程碑的实现计划。  
计划必须建立在当前项目已有实现之上,不额外扩展 `0.10` 范围之外的新业务。

对应的说明文档见:

- [docs/milestones/0.10.md](/Volumes/Projects/atom_next/docs/milestones/0.10.md)
- [docs/memory.md](/Volumes/Projects/atom_next/docs/memory.md)

---

## 当前结论

### 当前已经存在的基础

当前项目中,`0.10` 需要的部分基础已经存在:

- `IntentRequestType` 已定义 `SEARCH_MEMORY` / `SAVE_MEMORY`
- `Runtime Context` 已预留 `<Memory>` 区块
- `Core` 已具备安全请求串行消费入口
- `FOLLOW_UP` 链路已经存在

### 当前缺口

当前仍然缺少:

- 系统内独立的 `MemoryService`
- Memory 数据库存储层
- `MemoryNode` / `LinkNode` 类型与 schema
- `memory_events` 审计层
- `SEARCH_MEMORY` 的真实执行
- `SAVE_MEMORY` 的真实执行
- `Runtime` 对 Memory 结果的接收与输出
- Memory 后台维护能力

---

## 实现边界

### 本次只做

- 建立系统内独立 `MemoryService`
- 落地 `long` Memory 存储层
- 把连接关系改成 `source -> target` 有向边模型
- 固定 `type` / `confidence` / `source` / `status` 等核心字段
- 实现 `SEARCH_MEMORY`
- 实现 `SAVE_MEMORY`
- 实现保存前最小去重与冲突判断
- 实现 Memory 维护能力
- 把 Memory 结果接入 `Runtime(Core)` 闭环

### 本次不做

- 不实现 `LOAD_SKILL` 的真实业务
- 不新增新的 `Intent Request` 类型
- 不实现 TUI Memory 管理界面
- 不做多层 Memory 深度遍历输出
- 不做全自动记忆压缩与自动重写
- 不在本阶段实现完整语义向量检索

---

## 实施拆解

## 阶段1: 基础类型与存储层

目标:

- 补齐 `MemoryNode` / `LinkNode` 类型
- 落地 `sqlite` schema
- 建立基础索引

本阶段完成后应满足:

- `memory_nodes` / `link_nodes` / `memory_events` 表可初始化
- `memory_nodes.scope` 已纳入固定 schema
- `LinkNode` 已改为 `source_memory_id -> target_memory_id` 模型
- `type` / `confidence` / `source` / `status_reason` / `superseded_by_memory_id` 已纳入固定 schema
- 类型定义与表结构一致
- 基础查询入口具备可实现前提

---

## 阶段2: `MemoryService`

目标:

- 在 `src/services` 中建立独立 `MemoryService`
- 将其接入 `ServiceManager`
- 提供语义化方法:
  - `getMemoryByKey`
  - `searchMemory`
  - `getRelatedMemories`
  - `saveMemory`
  - `updateMemory`
  - `markMemoryStatus`
  - `retrieveRuntimeContext`
  - `recalculateLinkScores`
  - `cleanupMemories`
  - `mergeMemories`

本阶段完成后应满足:

- `Core` 不需要直接操作数据库
- `Runtime` 不需要感知底层持久化细节
- Memory 维护动作有独立服务边界

---

## 阶段3: 输出格式收口

目标:

- 固定 `MemoryService -> Runtime(Core)` 的默认输出结构
- 保持只输出:
  - 一条完整 `memory`
  - 一层 `links`

输出格式必须满足:

- `memory` 输出:
  - `key`
  - `text`
  - `meta.created_at`
  - `meta.updated_at`
  - `meta.score`
  - `meta.status`
  - `meta.confidence`
  - `meta.type`

- `retrieval` 输出:
  - `mode`
  - `relevance`
  - `reason`

- `links` 输出:
  - `target_memory_key`
  - `target_summary`
  - `link_type`
  - `term`
  - `weight`

- 默认不输出:
  - `memory.id`
  - `memory.summary`
  - `links[].id`
  - `links[].target_memory_id`
  - 内部统计参数

---

## 阶段4: Core / Runtime 接入

目标:

- `Core` 在消费 `SEARCH_MEMORY` 时调用 `MemoryService.searchMemory`
- `Core` 在消费 `SAVE_MEMORY` 时调用 `MemoryService.saveMemory`
- `Runtime` 在需要组装上下文时调用 `MemoryService.retrieveRuntimeContext`
- `Runtime` 能接收并输出 Memory 结果

本阶段完成后应满足:

- `SEARCH_MEMORY` 不再是占位动作
- `SAVE_MEMORY` 不再是占位动作
- `<Memory>` 区块开始具备真实内容

---

## 阶段5: Memory 维护机制

目标:

- 建立 Memory 后台维护能力
- 不对 LLM 暴露直接删除记忆的能力

本阶段需要明确:

- `LinkNode` 的 score 可以定时重算
- 记忆可以先被标记为 `cold` / `stale` / `deprecated` / `pending_delete`
- 后台整理流程负责自动清理这类记忆
- 后台整合流程负责处理长期运行后的碎片化 Memory
- 审计事件会写入 `memory_events`

本阶段维护流程至少包括:

- `RECALCULATE_LINK_SCORE`
- `MARK_STALE_MEMORIES`
- `DETECT_DUPLICATES`
- `MERGE_CANDIDATES`
- `CLEAN_PENDING_DELETE`

关键约束:

- LLM 不直接删除长期记忆
- 清理动作通过状态流转 + 后台维护完成

---

## 阶段6: `FOLLOW_UP` 闭环

目标:

- 让 Memory 结果能进入后续 `FOLLOW_UP`

关键约束:

- 当前 Memory 输出只保留一层 `links`
- 不在本阶段扩展更深层遍历
- `FOLLOW_UP` 只消费当前已加载 Memory 结果

---

## 阶段7: 测试

至少需要补齐下面几类测试:

### 1.存储层

- 表初始化成功
- 基础 schema 与索引可用

### 2.`MemoryService`

- 保存成功
- 搜索成功
- 单条读取成功
- 相关记忆读取成功
- 运行时上下文检索成功
- 更新成功
- 状态更新成功
- 最小去重与冲突判断成功
- link score 重算成功
- 整理流程可执行
- 整合流程可执行
- 审计事件写入成功

### 3.Runtime / Core

- `SEARCH_MEMORY` 会真实调用 MemoryService
- `SAVE_MEMORY` 会真实调用 MemoryService
- Memory 结果能进入 Runtime Context
- `FOLLOW_UP` 能继续消费 Memory 结果

---

## 实施顺序

建议按下面顺序执行:

1. 先落地类型与 schema
2. 再实现 `MemoryService`
3. 再收口默认输出格式
4. 再接入 `Core` / `Runtime`
5. 最后补测试

这样安排的原因是:

- 先把基础数据边界固定
- 再建立服务层
- 再让运行时消费稳定格式

---

## 完成标准

当以下条件全部满足时,可以认为 `PLAN_0.10` 对应工作完成:

1. `MemoryService` 已落地
2. `MemoryNode` / `LinkNode` / `memory_events` 存储层已落地
3. 默认输出格式已固定
4. `SEARCH_MEMORY` / `SAVE_MEMORY` 已接入运行时闭环
5. 保存前最小去重与冲突判断已落地
6. Memory 维护机制已落地
7. `FOLLOW_UP` 可继续消费 Memory 结果
8. 相关测试通过
