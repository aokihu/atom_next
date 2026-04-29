# Atom Next

Atom Next 是一个本地优先的 AI 驱动开发工具，提供终端内智能编码辅助体验。

## Features

- **本地优先** — 所有数据处理在本地完成，支持离线工作
- **多模型支持** — DeepSeek、OpenAI 及兼容接口
- **双模式运行** — 独立 Server 模式 / Terminal UI (TUI) 客户端模式
- **智能意图预测** — 在正式对话前预测用户意图，优化响应
- **长期记忆** — 基于 SQLite + FTS5 的记忆系统，支持语义搜索
- **工具调用** — 内置文件读写、搜索、git、bash 等开发工具
- **Context-Aware** — 文件系统监控自动管理 Agent 上下文
- **流式输出** — 实时流式响应，支持多轮对话与 Follow-up

## Architecture

```
CLI → Bootstrap → ServiceManager → Core → APIServer + TUI
                                          │
                              Queue → Runtime → Transport → Runtime
```

### Core 主链

```
Queue → Runtime → Transport → Runtime
```

- **Queue** — 优先级任务队列，负责任务生命周期推进
- **Runtime** — 运行时上下文与状态编排，组装 prompt、管理 memory、执行 intent request
- **Transport** — 模型通信层，处理流式输出与工具调用

### Core Workflows

- **User Intent Prediction** — 外部任务入队后预测用户意图
- **Formal Conversation** — 主对话链路，含工具调用、intent request 解析与记忆操作
- **Post Follow-up** — 长对话续接预处理

## Quick Start

```bash
# 安装依赖
bun install

# 开发模式运行（默认 both 模式: Server + TUI）
bun run dev

# 仅启动 Server
bun run src/main.ts --mode server --port 8080

# 仅启动 TUI 客户端
bun run src/main.ts --mode tui --server-url http://127.0.0.1:8080

# 构建可执行文件
bun run build:bin

# 运行测试
bun test
```

## CLI

```
Atom Next - AI 驱动的开发工具

选项:
  -v, --version          显示版本信息
  -h, --help             显示帮助信息
  -m, --mode <mode>      启动模式: tui | server | both (默认: both)
  -c, --config <path>    配置文件路径 (默认: {workspace}/config.json)
  -w, --workspace <path> 工作目录 (默认: 当前目录)
  --sandbox <path>       沙箱目录 (默认: {workspace}/sandbox)
  --address <host>       监听地址 (默认: 127.0.0.1)
  --port <port>          监听端口 (默认: 自动分配)
  --server-url <url>     TUI 模式下的服务器地址
  --log-pipe <path>      日志命名管道输出
  --log-file             启用文件日志 (输出到 {workspace}/logs/)
  --log-silent           禁用所有日志输出
  --context-pipe <path>  上下文命名管道输出
```

## Configuration

Atom 通过 `config.json` 配置文件管理运行时行为，支持多 provider、多 model profile、自定义主题等。

默认配置文件位于 `{workspace}/config.json`。

### Provider 配置

```json
{
  "providers": {
    "deepseek": {
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "models": {
        "chat": "deepseek-chat",
        "fast": "deepseek-chat"
      }
    },
    "openai": {
      "apiKeyEnv": "OPENAI_API_KEY",
      "models": {
        "chat": "gpt-4o",
        "fast": "gpt-4o-mini"
      }
    }
  },
  "profiles": {
    "default": {
      "provider": "deepseek",
      "model": "chat"
    }
  }
}
```

## Project Structure

```
src/
├── main.ts              # 应用入口
├── api/                 # HTTP API 服务器
├── assets/              # 静态资源 (prompts, themes)
│   ├── prompts/         # 系统/意图/记忆/follow-up prompt 模板
│   └── themes/          # nord, ocean, forest, sunset, paper
├── bootstrap/           # 启动编排 (CLI解析, 环境加载, 配置解析)
├── core/                # 核心引擎
│   ├── core.ts          # Core 主调度器
│   ├── queue/           # 任务队列 (优先级队列)
│   ├── runtime/         # 运行时服务域 (context/prompt/intent/memory)
│   ├── transport/       # 模型通信层
│   └── workflows/       # 对话工作流
├── libs/                # 共享工具库 (log, task, memory-storage, service-manager)
├── services/            # 应用级服务
│   ├── runtime.ts       # 运行时状态服务
│   ├── memory.ts        # 长期记忆服务 (SQLite)
│   ├── watchman/        # 文件监控 & prompt 编译
│   └── tools/           # 工具调用 (read, write, bash, git, etc.)
├── tui/                 # 终端 UI (基于 @opentui/react)
└── types/               # TypeScript 类型定义
```

## Development

```bash
# 类型检查
bun run typecheck

# 运行测试 (watch 模式)
bun run test:watch

# 运行特定测试文件
bun test tests/core/core.test.ts
```

## Dependencies

- **Runtime**: [Bun](https://bun.sh)
- **UI**: [@opentui/react](https://github.com/opentui/opentui) + React
- **AI SDK**: [Vercel AI SDK](https://sdk.vercel.ai) (v6)
- **Database**: SQLite (bun:sqlite)
- **State**: Zustand
- **Validation**: Zod

## Milestones

项目里程碑文档位于 `docs/milestones/`，涵盖从基础对话链路到多 Session、Follow-up、长期记忆等完整功能演进。

详细设计文档见 `docs/`。
