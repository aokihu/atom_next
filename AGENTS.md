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

## GStreamer Like 架构设计

Core 的设计采用精简版 GStreamer-like 思路，但只取项目需要的部分。目标不是复制 GStreamer，而是让任务执行结构更清楚、更低复杂度。

### 1. 基本模型

```text
Queue    = 播放列表
Task     = 一首歌曲 / 一张待办卡片
Pipeline = 处理一个 Task 的完整流程
Element  = Pipeline 中的独立处理组件
Action   = 一组相关 Task 的追踪集合
```

核心规则：

```text
一个 Task 只进入一个 Pipeline。
Pipeline 负责把这个 Task 从开始处理到结束。
Pipeline 由多个 Element 组成。
每个 Element 只做一件专一的事情。
Pipeline 最终返回 PipelineResult。
Core 根据 PipelineResult 决定是否继续加入下一个 Task。
```
