# atom_next

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.10. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Docs Index

`docs/` 目录中的非里程碑文档统一在这里建立索引，后续查找设计和讨论文档时，优先从这里定位。

### Memory

- [docs/memory.md](/Volumes/Projects/atom_next/docs/memory.md)
  - 记忆系统主设计文档
  - 说明 `MemoryService`、图结构、运行时输出和长期记忆相关设计

- [docs/memory-intent-request.md](/Volumes/Projects/atom_next/docs/memory-intent-request.md)
  - `Intent Request` 与记忆系统之间的对齐说明
  - 主要用于梳理 `SEARCH_MEMORY`、`SAVE_MEMORY` 等请求与记忆设计的关系

### Workflow

- [docs/workflow.md](/Volumes/Projects/atom_next/docs/workflow.md)
  - `Core` workflow 设计讨论文档
  - 说明 `Queue -> Runtime -> Transport -> Runtime` 主链、内部任务交接和统一 `Intent Request` 协议方向

## Milestones

里程碑文档位于 [docs/milestones](/Volumes/Projects/atom_next/docs/milestones)。
