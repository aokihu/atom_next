# PLAN 0.11

## 目标

为 `atom_next` 落地一套可在启动早期使用的基础日志系统，补齐 `bootstrap -> services -> core -> api/tui` 的运行观测能力。

本计划只解决 `0.11` 里程碑内的基础日志能力，不引入全局事件总线，不把日志系统注册为 service，也不扩展远程日志、日志检索、复杂日志 UI。

---

## 当前现状

当前代码已经存在 `src/libs/log/index.ts`，但尚未形成可用日志系统，关键路径仍直接依赖 `console.*`：

- `src/main.ts`
- `src/bootstrap/config.ts`
- `src/api/api.ts`
- `src/services/watchman/watchman.ts`
- `src/core/runtime/intent-request/runtime/handle.ts`

另外，`src/bootstrap/cli.ts` 当前没有任何 `--log-*` 参数，`main.ts` 也还是在 `tryBootstrap()` 失败后直接输出 `console.error`。

这意味着：

- bootstrap 失败时没有统一日志出口
- 启动阶段还不能按 mode 和日志参数控制输出目标
- TUI 无法通过命名管道消费调试日志
- 日志仍然和 CLI 标准输出耦合

---

## 已确认设计

### 1. 单进程只创建一个 LogSystem

`LogSystem` 是日志基础设施实例，不是一个“初始化动作”。

实现约束：

- 每个应用进程只创建一次 `LogSystem`
- 每个 `LogSystem` 内部只持有一个 `LogHub`
- 业务模块不直接创建 `LogHub`
- 业务模块不直接装配 sink

默认调用链：

```text
parseArguments -> parseLogConfig -> createLogSystem -> createLogger
```

---

### 2. LogHub 只属于 LogSystem 内部

`LogHub` 是日志事件分发中心，但它不是公共基础对象，不应该向 `Core / Runtime / Queue / Transport` 透传。

对外边界保持为：

```text
LogSystem:
  createLogger(source)
  subscribe(listener)

Logger:
  debug/info/warn/error
```

---

### 3. 启动期先解析日志配置，再创建 LogSystem

日志系统必须在 bootstrap 阶段可用，因此启动顺序调整为：

```text
1. parseArguments
2. parseLogConfig
3. createLogSystem
4. create bootstrap logger
5. run bootstrap
6. create services / service manager
7. create core
8. start api / tui
9. run core loop
```

这里的关键约束是：

- 不能等 `tryBootstrap()` 完成后才创建日志系统
- 不能把日志配置解析下沉到 service 层
- 不能通过 `ServiceManager` 反向创建日志系统

---

### 4. 日志输出规则

#### 4.1 CLI 参数

新增启动参数：

- `--log-pipe <path>`
- `--log-file`
- `--log-silent`

不新增 `stdout` 显式开关，`stdout` 是否输出由 `mode` 决定。

#### 4.2 规则

- `--log-pipe <path>`
  使用用户指定的已有命名管道输出，供 TUI 或本地调试消费者读取。
- `--log-file`
  启用文件输出，在 `{workspace}/logs` 目录保存日志。
- `--log-silent`
  禁用所有日志 sink。
- `--mode=server`
  允许日志输出到 CLI `stdout`。
- `--mode=tui` 或 `--mode=both`
  不允许日志输出到 CLI `stdout`。

#### 4.3 优先级

`--log-silent` 优先级最高：

```text
--log-silent > stdout/file/pipe
```

只要启用 `--log-silent`：

- 不输出 `stdout`
- 不输出 file
- 不输出 pipe
- 日志系统仍可创建，但只挂空 sink

#### 4.4 默认行为

第一版默认行为固定为：

- `mode=server` 时默认启用 `stdout sink`
- `mode=tui` / `mode=both` 时默认不启用 `stdout sink`
- `file sink` 默认关闭，只有传入 `--log-file` 才开启
- `pipe sink` 默认关闭，只有传入 `--log-pipe <path>` 且路径可用才开启

---

### 5. 路径约定

为保证计划可执行，第一版文件路径固定，管道路径由用户显式指定：

- 日志目录：`{workspace}/logs`
- 文件日志路径：`{workspace}/logs/atom-YYYY-MM-DD.log.jsonl`
- 命名管道路径：由 `--log-pipe <path>` 显式指定

说明：

- `file sink` 使用 JSONL 方便后续逐行读取和调试
- `file sink` 按日期生成单独日志文件，避免单个日志文件持续膨胀
- `pipe sink` 使用用户显式指定路径，避免应用自行创建系统级 FIFO
- 后续如需扩展更多日志路径参数，再放到后续里程碑，不在 `0.11` 扩展

---

### 6. 命名管道行为

命名管道是本计划里最容易把启动链路做坏的点，行为需要先写死：

- 如果 `--log-pipe <path>` 指定的路径不存在，只通过 `console.warn` 告知用户无法使用管道调试输出，应用继续启动
- 如果该路径已存在但不是 FIFO，只通过 `console.warn` 告知用户无法使用管道调试输出，应用继续启动
- `pipe sink` 不能因为没有 reader 而阻塞应用启动
- `pipe sink` 采用 best-effort 语义，消费者不存在时允许丢弃写入，不影响主流程
- 命名管道写入实现统一使用 `pipelogger`

这条约束的核心目的是：

- TUI 可以通过用户指定命名管道读取调试日志
- 服务端启动不能因为 FIFO 没有消费者而卡死

补充约束：

- `pipelogger` 只负责向 FIFO 写入，不负责创建 FIFO
- FIFO 必须由用户手动创建，应用不主动创建命名管道
- FIFO 的存在性和类型校验由日志配置解析阶段处理
- `pipe-sink.ts` 只封装 `pipelogger`，不重复实现一套底层 FIFO 写入逻辑

---

## 模块边界

### LogSystem 负责

- 初始化 `LogHub`
- 根据 `LogSystemConfig` 装配 sink
- 创建 `Logger`
- 归一化错误对象
- 分发日志事件

### Logger 负责

- 面向业务模块暴露 `debug/info/warn/error`
- 把 `message + options` 转成标准 `LogEntry`
- 自动带上 `source`

### LogHub 负责

- 进程内日志分发
- 管理订阅关系
- 不承担业务事件职责

### Sink 负责

- 把 `LogEntry` 输出到目标介质
- sink 失败不允许影响主流程

### Bootstrap 负责

- 解析 `--log-*`
- 根据 `mode` 和日志参数生成 `LogSystemConfig`
- 创建唯一 `LogSystem`

### ServiceManager / Core / API / Watchman 负责

- 只消费注入的 `Logger`
- 不创建 sink
- 不直接依赖 `LogHub`

---

## 推荐目录

```text
src/libs/log/
  index.ts
  types.ts
  log-system.ts
  logger.ts
  log-hub.ts
  normalize-error.ts
  formatters/
    pino-format.ts
  sinks/
    stdout-sink.ts
    file-sink.ts
    pipe-sink.ts
```

说明：

- `formatters/pino-format.ts` 负责把 `LogEntry` 转换为 pino 输出参数
- `stdout-sink.ts` / `file-sink.ts` / `pipe-sink.ts` 负责各自目标介质的写入策略
- 第一版不强制实现 `memory-sink`
- `pipe-sink.ts` 内部基于 `pipelogger` 实现
- 如果实现中发现 `stdout/file/pipe` 三者可以通过更少代码聚合为一个通用 stream sink，可以在不破坏边界的前提下收敛实现，但对外文件职责不变

---

## 需要改动的现有文件

### 启动与参数解析

- `src/bootstrap/cli.ts`
- `src/bootstrap/bootstrap.ts`
- `src/bootstrap/index.ts`
- `src/main.ts`

### 日志基础设施

- `src/libs/log/index.ts`
- `src/libs/log/*`

### 日志接入

- `src/libs/service-manage.ts`
- `src/core/core.ts`
- `src/api/api.ts`
- `src/bootstrap/config.ts`
- `src/services/watchman/watchman.ts`
- `src/core/runtime/intent-request/runtime/handle.ts`

说明：

- `src/bootstrap/cli.ts` 中的 `help/version` 仍然允许直接输出到 CLI，不归日志系统管理
- `src/tui/theme.ts` 的 `warn = console.warn` 暂不纳入 `0.11` 关键路径，如果后续确认会污染交互输出，再单独收敛

---

## 实施步骤

### Phase 1: 补齐 CLI 与日志配置解析

- [ ] 在 `src/bootstrap/cli.ts` 新增 `--log-pipe <path>`、`--log-file`、`--log-silent`
- [ ] 扩展 `BootArguments`，保留原始 CLI 语义，不把 sink 对象放进启动参数
- [ ] 新增 `parseLogConfig(args)`，把 `BootArguments` 转成 `LogSystemConfig`
- [ ] 明确 `stdout sink` 由 `mode` 派生，而不是新增 `--log-stdout`
- [ ] 明确 `--log-silent` 的最高优先级

Phase 1 完成标准：

- `parseArguments` 能稳定产出日志相关参数
- `parseLogConfig` 能稳定决定 `stdout/file/pipe/silent`
- `mode=tui` / `mode=both` 下不会误开 `stdout sink`

### Phase 2: 调整启动顺序

- [ ] 将日志系统创建移动到 bootstrap 前置阶段
- [ ] 保持 CLI 参数只解析一次，避免 `main.ts` 与 `bootstrap.ts` 重复解析
- [ ] 为 bootstrap 创建专用 logger
- [ ] bootstrap 失败时通过统一日志系统输出错误

推荐收敛方式：

- 保留 `parseArguments` 作为 CLI 单一入口
- 把 `bootstrap()` 改造成接收已解析 `cliArgs` 的函数
- `main.ts` 先拿到 `cliArgs` 和 `LogSystem`，再调用 bootstrap

Phase 2 完成标准：

- bootstrap 错误不再直接依赖 `console.error`
- 应用启动早期已经具备统一日志能力

### Phase 3: 实现 libs/log 基础模块

- [ ] 定义 `LogLevel`、`LogEntry`、`LogOptions`、`Logger`、`LogSink`
- [ ] 定义 `LogSystemConfig`
- [ ] 实现 `normalizeError(error)`
- [ ] 实现 `LogHub`
- [ ] 实现 `createLogger(source)`
- [ ] 实现 `createLogSystem(config)`
- [ ] 实现 `stdout sink`
- [ ] 实现 `file sink`
- [ ] 安装并接入 `pipelogger`
- [ ] 基于 `pipelogger` 实现 `pipe sink`

实现约束：

- sink 写入失败只能内部吞掉并降级，不能打断业务流程
- `message` 保持稳定英文短句
- 动态字段统一写入 `data`
- `unknown error` 必须走统一归一化
- `pipe sink` 只做 `LogEntry -> pipelogger` 的适配，不重写 FIFO 底层协议

Phase 3 完成标准：

- `logger.info/error(...)` 可以产出标准 `LogEntry`
- 多 sink 可以同时收到同一条日志
- sink 异常不会影响主流程

### Phase 4: 接入关键路径

- [ ] `src/main.ts` 改用 logger 输出 bootstrap / service startup / api startup / runloop 相关日志
- [ ] `src/libs/service-manage.ts` 支持注入 logger，并记录 service 启动过程
- [ ] `src/core/core.ts` 接入 core logger，记录 runloop started、task activated、workflow failed
- [ ] `src/api/api.ts` 接入 api logger，替换 chat session 同步里的 `console.error`
- [ ] `src/bootstrap/config.ts` 接入 bootstrap logger，替换配置警告输出
- [ ] `src/services/watchman/watchman.ts` 接入 watchman logger
- [ ] `src/core/runtime/intent-request/runtime/handle.ts` 接入 runtime logger

接入原则：

- 大多数模块只注入 `Logger`
- 只有装配入口层持有 `LogSystem`
- 不通过 `getXxxManager()` 暴露日志内部对象

Phase 4 完成标准：

- 关键路径不再直接依赖 `console.log / console.error / console.warn`
- `core`、`service-manager`、`bootstrap`、`api` 都能带 source 输出日志

### Phase 5: 文件与管道输出收口

- [ ] 启用 `--log-file` 时自动创建 `{workspace}/logs`
- [ ] 启用 `--log-pipe <path>` 时检查路径是否存在且为 FIFO
- [ ] 如果 pipe 路径不存在或不是 FIFO，通过 `console.warn` 告警并关闭 pipe sink，应用继续启动
- [ ] 在 FIFO 可用后，再初始化 `pipelogger`
- [ ] 保障 FIFO 不会因为无 reader 阻塞写入
- [ ] 明确 `mode=server` 才允许 `stdout sink`

Phase 5 完成标准：

- `--log-file` 可在 `{workspace}/logs/atom-YYYY-MM-DD.log.jsonl` 看到日志
- `--log-pipe <path>` 可被 TUI 或本地消费者读取
- `mode=both` 不会污染标准输出

### Phase 6: 补最小验证

- [ ] 为 `parseArguments` 增加日志参数解析用例
- [ ] 为 `parseLogConfig` 增加优先级测试
- [ ] 为 `normalizeError` 增加单测
- [ ] 为 `createLogger` 增加 source/data/error 组装测试
- [ ] 为 `LogHub` 增加多 sink 分发测试
- [ ] 为 `pipe sink` 增加“不阻塞启动”的验证

---

## 日志配置建议

### BootArguments

建议只保存原始 CLI 语义：

```ts
type BootArguments = {
  mode: "tui" | "server" | "both";
  workspace: string;
  config: string;
  sandbox: string;
  serverUrl: string;
  address: string;
  port?: number;
  logPipe?: string;
  logFile: boolean;
  logSilent: boolean;
};
```

### LogSystemConfig

由 `parseLogConfig(args)` 派生，供日志系统装配使用：

```ts
type LogSystemConfig = {
  level: "debug" | "info" | "warn" | "error";
  enableStdout: boolean;
  enableFile: boolean;
  enablePipe: boolean;
  silent: boolean;
  workspace: string;
  logsDir: string;
  pipePath?: string;
};
```

这样可以保持：

- `BootArguments` 只表达 CLI 输入
- `LogSystemConfig` 只表达日志装配结果
- `RuntimeService` 不需要知道 sink 细节

---

## 关键日志文案

第一版日志 message 固定为稳定英文短句，不拼接动态信息：

推荐：

- `Bootstrap started`
- `Bootstrap completed`
- `Bootstrap failed`
- `Service started`
- `Service startup failed`
- `Core initialized`
- `Core runloop started`
- `Task activated`
- `Workflow failed`
- `API server started`
- `API server failed`

动态上下文放到 `data`：

```ts
logger.info("API server started", {
  data: {
    host,
    port,
    url,
  },
});
```

---

## 验收标准

完成本计划后，必须满足：

- [ ] `bootstrap` 失败可以通过统一日志系统输出
- [ ] `ServiceManager` 启动阶段可以记录每个 service 的启动结果
- [ ] `Core` workflow 失败时可以记录 `taskId / sessionId / chatId / error`
- [ ] `API` 同步 chat 生命周期失败时不再直接调用 `console.error`
- [ ] `--mode=server` 时日志可输出到 CLI `stdout`
- [ ] `--mode=tui` / `--mode=both` 时日志不会污染 `stdout`
- [ ] `--log-file` 时日志写入 `{workspace}/logs/atom-YYYY-MM-DD.log.jsonl`
- [ ] `--log-pipe <path>` 时 TUI 可以通过用户指定 FIFO 消费日志
- [ ] `--log-silent` 时所有 sink 都关闭
- [ ] 日志系统不依赖 `ServiceManager`
- [ ] `LogHub` 不向业务模块暴露

---

## 非目标

本计划不处理：

- 全局事件总线
- Chat 业务事件替换
- OpenTelemetry
- 远程日志上传
- 复杂日志搜索
- TUI 日志面板完整 UI
- 自定义日志路径参数
- 多进程日志聚合

---

## 依赖

本计划新增依赖：

- `pino`
- `mitt`
- `pipelogger`

安装命令：

```sh
bun add pino mitt pipelogger
```

其中：

- `pino` 负责结构化日志输出
- `mitt` 负责 `LogHub` 内部分发
- `pipelogger` 负责命名管道写入

---

## 实施提醒

这个计划的重点不是“把 `console.log` 换个壳”，而是把日志系统前移成启动基础设施。

落地时必须持续检查三件事：

- 依赖方向是否仍然是 `Bootstrap / ServiceManager / Core -> depends on LogSystem`
- 是否仍然只有一个 `LogSystem`
- FIFO 写入是否会阻塞启动链路
