# PLAN 0.12

## 目标

为 `atom_next` 落地一套独立的 Tools 能力,让正式对话支持真实 tool calling,并在不破坏当前 `Queue -> Runtime -> Transport -> Runtime` 主链路的前提下,支持单轮多步工具调用与 `FOLLOW_UP` 续跑。

本计划只解决 `0.12` 里程碑内的 Tools 基础能力,不引入 MCP 聚合、不做远程工具市场、不实现复杂工具 UI,也不把整个系统改造成 `atom` 的完整 agent 架构。

---

## 当前现状

当前代码已经具备:

- `Core` 轮询消费 task queue
- `Runtime` 负责 prompt、intent request 和 follow-up 编排
- `Transport` 负责模型请求和流式文本处理
- `Intent Request` 负责内部 workflow 请求协议

但当前还没有真正的 tools 运行链路:

- `Transport.send()` 只处理文本流和 `intentRequestText`
- 正式对话 workflow 中没有 tool registry 注入
- 系统内没有独立 `ToolService`
- `Runtime` 也没有工具结果摘要上下文

这意味着:

- 当前模型不能真实调用文件/命令类工具
- 当前系统不支持单轮多步工具调用
- 当前 `FOLLOW_UP` 不能延续工具执行后的上下文

---

## 已确认设计

### 1. Tools 是独立服务域

Tools 应位于 `services` 层,作为独立服务存在。

推荐目录:

```text
src/services/tools/
```

不推荐:

```text
src/core/runtime/tools/
src/core/transport/tools/
```

原因:

- 具体工具实现不属于 `Runtime` 内部实现
- 工具定义和权限控制不属于 `Transport`
- 独立服务边界更符合当前项目已经建立的 `MemoryService` 形态

---

### 2. Runtime 只负责工具编排

`Runtime` 在 `0.12` 中新增的职责应当是高层编排能力,例如:

- 构造当前 task 的工具执行上下文
- 生成本轮可用的 tool registry
- 记录工具执行摘要
- 把工具摘要纳入 prompt context

`Runtime` 不应直接持有:

- 工具注册器内部对象
- 具体权限策略实现
- 单个工具的执行实现

---

### 3. Transport 承载原生 tool calling

`Transport` 需要从“纯文本请求发送器”升级为“支持 tool loop 的模型调用层”。

`Transport` 的新增能力应包括:

- 接收 `tools`
- 接收单轮 stop 条件
- 接收 tool call start / finish hooks
- 在单轮 conversation 内继续工具调用循环

但 `Transport` 仍不应负责:

- 工具选择策略
- 工具权限
- `FOLLOW_UP` 派生

---

### 4. Intent Request 不扩展为通用工具协议

`Intent Request` 继续用于:

- workflow 控制
- `PREPARE_CONVERSATION`
- `FOLLOW_UP`
- memory / skill 这类运行时动作

不新增:

- `RUN_TOOL`
- `READ_FILE`
- `EXEC_BASH`

之类的通用工具型 `Intent Request`。

原因:

- 工具调用属于模型执行期的多步交互
- 这部分更适合走原生 tool calling
- 如果继续塞进 `Intent Request`,会让协议层迅速膨胀

---

### 5. 多轮工具调用分两层实现

#### 5.1 单轮多步工具调用

用于解决:

```text
model -> tool -> model -> tool -> model
```

这部分由 `Transport` 的 tool loop 承载。

#### 5.2 跨 task 的续跑

用于解决:

```text
round 1 tool summary
-> Runtime context
-> FOLLOW_UP
-> round 2 continue
```

这部分由:

- `Runtime` 保存摘要
- `Queue` 派生 `FOLLOW_UP`

承载。

---

### 6. 工具结果只进入摘要上下文

第一版不把完整工具原始输出长期挂在 Runtime context 中。

保留原则:

- 当前轮工具执行用原始结果
- 后续轮次只消费工具摘要

推荐摘要字段:

- toolName
- inputSummary
- outputSummary
- ok
- errorMessage
- updatedAt

---

### 7. 首版采用小步快行策略

`0.12` 不一次把全部工具做完,按风险拆三层推进:

#### Phase 1

- `read`
- `ls`
- `tree`
- `ripgrep`

#### Phase 2

- `write`
- `cp`
- `mv`

#### Phase 3

- `bash`
- `git`

---

## 模块边界

### ToolService 负责

- registry 创建
- 内置工具工厂
- 工具权限策略
- 工具 budget / guard / settled hook
- 工具输出包装

### Runtime 负责

- 为当前 task 构造工具上下文
- 暴露当前轮可用 tools
- 汇总工具执行摘要
- 让后续 prompt 可消费这些摘要

### Transport 负责

- 把 tools 传给模型
- 驱动单轮 tool loop
- 回传工具事件

### Queue 负责

- task 推进
- `FOLLOW_UP` 续跑

---

## 推荐目录

```text
src/services/tools/
  index.ts
  tool-service.ts
  types.ts
  registry/
    index.ts
    factories.ts
    output-wrapper.ts
  permissions/
    index.ts
    policy.ts
  read.ts
  ls.ts
  tree.ts
  ripgrep.ts
  write.ts
  cp.ts
  mv.ts
  bash.ts
  git.ts
```

配套改动目录:

```text
src/core/runtime/
  tool-context/
  prompt/

src/core/transport/
  transport.ts
  tool-loop.ts
```

这里的 `tool-loop.ts` 只是推荐拆分方式。  
如果最终实现证明直接收敛到 `transport.ts` 更清晰,可以不强拆文件。

---

## 分阶段实施计划

### Step 1. 建立 ToolService 基础骨架

目标:

- 增加 `ToolService`
- 建立 `ToolExecutionContext`
- 建立 registry 与工具工厂结构

输出结果:

- `services/index.ts` 可导出 `ToolService`
- `ServiceManager` 可注册 tools service
- 首版工具 registry 可以独立构造

约束:

- 不接入 workflow
- 不修改 `FOLLOW_UP` 逻辑

---

### Step 2. 落地只读工具

目标:

- 落地 `read / ls / tree / ripgrep`

输出结果:

- 只读工具可以独立执行
- 权限策略可约束 workspace 边界

约束:

- 不开放写操作
- 不开放 shell / git

---

### Step 3. 扩展 Transport 的 tools 能力

目标:

- `Transport.send()` 支持 `tools`
- 支持单轮 `maxToolSteps`
- 支持 tool call start / finish hooks

输出结果:

- 正式对话单轮内可执行多步工具调用

约束:

- 不把工具逻辑写进 `Transport`
- 不把 workflow 控制逻辑写进 tool loop

---

### Step 4. Runtime 接入工具上下文

目标:

- `Runtime` 能按当前 task 生成 tool registry
- `Runtime` 能记录工具执行摘要
- prompt context 增加工具摘要块

输出结果:

- `FOLLOW_UP` 可继续消费前一轮工具执行摘要

约束:

- 只保留摘要
- 不把原始大输出长期写进上下文

---

### Step 5. workflow 接线

目标:

- formal conversation workflow 接入 tool registry
- 工具 settled 结果能回流到 `Runtime`

输出结果:

- `Queue -> Runtime -> Transport(with tools) -> Runtime -> Queue`
  链路成立

约束:

- workflow 仍只依赖 `Runtime`
- `Queue` 不感知工具

---

### Step 6. 落地写操作工具

目标:

- 增加 `write / cp / mv`

输出结果:

- 模型可在受控边界内完成基础文件编辑

约束:

- 需要独立写权限校验
- 需要测试覆盖路径边界

---

### Step 7. 落地高风险工具

目标:

- 增加 `bash / git`

输出结果:

- 系统具备基础命令执行与版本控制工具能力

约束:

- 需要单独的高风险 guard
- 需要单独 budget 和错误处理策略

---

## 测试计划

`0.12` 至少需要覆盖下面几类测试:

### 1. ToolService 测试

- registry 构造
- 名称冲突
- guard / budget / settled hook
- 权限策略

### 2. 单工具测试

- `read`
- `ls`
- `tree`
- `ripgrep`
- 后续写工具和高风险工具

### 3. Transport 测试

- 单轮 tool loop
- 多步工具调用停止条件
- 工具异常处理

### 4. Runtime 测试

- 工具摘要写入
- prompt context 输出
- `FOLLOW_UP` 继续消费工具摘要

### 5. workflow 测试

- formal conversation 接入 tools 后仍能完成
- 工具调用后仍能进入 `FOLLOW_UP`
- 工具失败时不会打坏 queue 状态

---

## 范围约束

本次计划明确不做:

- 不接入 MCP tools 聚合
- 不做工具市场
- 不做复杂的工具可视化界面
- 不做浏览器自动化能力
- 不把现有 `Intent Request` 重构成全工具协议
- 不复制 `atom` 的整套 agent runner
- 不一次性开放全部高风险工具

---

## 完成标准

当以下条件全部满足时,可以认为 `0.12` 完成:

1. 系统内存在独立 `ToolService`
2. formal conversation 支持真实 tool calling
3. 单轮 conversation 支持多步工具调用
4. `Runtime` 能记录和输出工具摘要上下文
5. `FOLLOW_UP` 能继续消费工具摘要
6. 只读工具已稳定可用
7. 写工具和高风险工具按计划落地
8. 权限、budget、guard 已具备
9. 相关测试通过

---

## 文档拆分

为了避免本文件同时承担“设计文档”和“里程碑说明”的职责,`0.12` 相关内容拆分如下:

- Tools 设计说明:
  - [docs/tools.md](/Volumes/Projects/atom_next/docs/tools.md)

- `0.12` 开发计划:
  - [docs/plans/PLAN_0.12.md](/Volumes/Projects/atom_next/docs/plans/PLAN_0.12.md)

- `0.12` 里程碑说明:
  - [docs/milestones/0.12.md](/Volumes/Projects/atom_next/docs/milestones/0.12.md)
