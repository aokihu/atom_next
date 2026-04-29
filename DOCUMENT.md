# 文档索引

> 版本: v0.1 | 更新日期: 2026-04-29

## 项目简介

Atom Next 是一个本地优先的 AI 驱动开发工具，基于 Bun 运行时，提供终端内智能编码辅助体验。

核心架构为 `Queue → Runtime → Transport → Runtime` 主链路，支持多模型（DeepSeek、OpenAI）、长期记忆、工具调用、多轮对话与 Terminal UI。

---

## 设计文档

| 文档 | 版本 | 更新日期 | 说明 |
|---|---|---|---|
| [docs/workflow.md](/Volumes/Projects/atom_next/docs/workflow.md) | v0.3 | 2026-04-29 | Core 工作流设计方向，包含 Intent Request 统一协议与三类 workflow。同步当前实现状态 |
| [docs/memory.md](/Volumes/Projects/atom_next/docs/memory.md) | — | — | MemoryService 设计边界、存储方式、数据结构与默认输出格式（对应里程碑 0.10） |
| [docs/memory-intent-request.md](/Volumes/Projects/atom_next/docs/memory-intent-request.md) | — | — | Intent Request 与 MemoryService 的设计对齐说明 |
| [docs/tools.md](/Volumes/Projects/atom_next/docs/tools.md) | — | — | Tools 能力设计边界、模块职责与工作链路（对应里程碑 0.12） |

---

## 开发计划

| 文档 | 说明 |
|---|---|
| [docs/plans/PLAN_0.12.md](/Volumes/Projects/atom_next/docs/plans/PLAN_0.12.md) | 0.12 开发计划：Tools 基础能力落地 |

---

## 里程碑

| 文档 | 说明 |
|---|---|
| [docs/milestones/0.1.md](/Volumes/Projects/atom_next/docs/milestones/0.1.md) | Milestone 0.1 — API 到 Transport 通路打通 |
| [docs/milestones/0.2.md](/Volumes/Projects/atom_next/docs/milestones/0.2.md) | Milestone 0.2 |
| [docs/milestones/0.3.md](/Volumes/Projects/atom_next/docs/milestones/0.3.md) | Milestone 0.3 |
| [docs/milestones/0.4.md](/Volumes/Projects/atom_next/docs/milestones/0.4.md) | Milestone 0.4 — TUI Client 准备 |
| [docs/milestones/0.5.md](/Volumes/Projects/atom_next/docs/milestones/0.5.md) | Milestone 0.5 |
| [docs/milestones/0.6.md](/Volumes/Projects/atom_next/docs/milestones/0.6.md) | Milestone 0.6 |
| [docs/milestones/0.7.md](/Volumes/Projects/atom_next/docs/milestones/0.7.md) | Milestone 0.7 |
| [docs/milestones/0.8.md](/Volumes/Projects/atom_next/docs/milestones/0.8.md) | Milestone 0.8 |
| [docs/milestones/0.9.md](/Volumes/Projects/atom_next/docs/milestones/0.9.md) | Milestone 0.9 |
| [docs/milestones/0.10.md](/Volumes/Projects/atom_next/docs/milestones/0.10.md) | Milestone 0.10 |
| [docs/milestones/0.11.md](/Volumes/Projects/atom_next/docs/milestones/0.11.md) | Milestone 0.11 — 基础日志系统与运行观测能力 |
| [docs/milestones/0.12.md](/Volumes/Projects/atom_next/docs/milestones/0.12.md) | Milestone 0.12 — Tools 能力与多步工具调用 |

---

## 其他文档

| 文档 | 说明 |
|---|---|
| [README.md](/Volumes/Projects/atom_next/README.md) | 项目概览与快速开始 |
| [AGENTS.md](/Volumes/Projects/atom_next/AGENTS.md) | AI 编码助手项目约定与开发规则 |
| [openspec/AGENTS.md](/Volumes/Projects/atom_next/openspec/AGENTS.md) | OpenSpec 规范驱动开发指令 |

---

## 文档版本约定

设计文档（`docs/` 下非 milestone/plan 的文档）建议在文档头部标注版本号和更新日期，格式：

```
> **版本**: v0.1
> **更新日期**: YYYY-MM-DD
```

里程碑和计划文档的版本以文档标题/文件名中的版本号为准。
