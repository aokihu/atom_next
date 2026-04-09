import { version } from "@/../package.json" with { type: "json" };
import { parseArgs, type ParseArgsConfig } from "node:util";
import { isAbsolute, resolve } from "node:path";
import { isEmpty, isNullish } from "radashi";
import { withDefault } from "@/libs";
import { DEFAULT_HOST } from "@constant";

type Mode = "tui" | "server" | "both";

type ParsedArguments = {
  version: boolean;
  help: boolean;
  mode: string;
  config: string;
  workspace: string;
  sandbox: string;
  "server-url": string;
  address: string;
  port: string;
};

export type BootArguments = Omit<
  ParsedArguments,
  "server-url" | "port" | "help" | "version"
> & {
  serverUrl: string;
  port?: number;
};

/**
 * 解析应用启动命令
 * @version 1.0.0
 * @description 应用启动命令：
 *              --version[v]    显示版本信息
 *
 *              --help[h]       显示帮助信息
 *
 *              --mode[m]       启动模式,默认是同时启动'tui'和'server',
 *                              如果设置为'tui'则只启动TUI客户端,需要配合参数--server-url指定服务器
 *                              如果设置为'server'则只启动Server服务器,可以单独通过--address和--port设置监听地址和端口

 *              --config[c]     指定加载特定的配置文件
 *
 *              --workspace[w]  指定特定的工作目录,如果不设置默认就是程序运行的当前目录
 *
 *              --sandbox       指定特定的沙箱目录,如果不指定默认就是{workspace}/sandbox
 *
 *              --server-url    当启动模式为'tui'时,需要制定链接的服务器
 *
 *              --address       服务器监听地址,如果不设置默认是127.0.0.1
 *
 *              --port          服务器监听端口,如果不设置默认是8787,如果被占用那么会自动寻找可以使用的端口
 */

/**
 * 显示帮助信息
 */
const printHelp = () => {
  const help = `
Atom Next - AI 驱动的开发工具

用法: atom [选项]

选项:
  -v, --version          显示版本信息
  -h, --help             显示帮助信息
  -m, --mode <mode>      启动模式 (default: "both")
                         - "tui": 只启动 TUI 客户端
                         - "server": 只启动 Server 服务器
                         - "both": 同时启动 TUI 和 Server
  -c, --config <path>    指定配置文件路径
  -w, --workspace <path> 指定工作目录 (default: 当前目录)
  --sandbox <path>       指定沙箱目录 (default: {workspace}/sandbox)
  --server-url <url>     TUI 模式下指定服务器地址,比如 http://127.0.0.1:8787
  --address <address>    服务器监听地址 (default: "127.0.0.1")
  --port <port>          服务器监听端口 (default: 8787)

示例:
  atom                          # 同时启动 TUI 和 Server
  atom --mode server            # 只启动 Server
  atom --mode tui --server-url ws://localhost:8787  # 只启动 TUI 连接到指定服务器
  atom --port 9000              # 指定 Server 端口
`;
  console.log(help);
};

const cliOpts: ParseArgsConfig["options"] = {
  version: {
    type: "boolean",
    short: "v",
  },
  help: {
    type: "boolean",
    short: "h",
  },
  mode: {
    type: "string",
    short: "m",
    default: "both",
  },
  config: {
    type: "string",
    short: "c",
  },
  workspace: {
    type: "string",
  },
  sandbox: {
    type: "string",
  },
  "server-url": {
    type: "string",
  },
  address: {
    type: "string",
    default: DEFAULT_HOST,
  },
  port: {
    type: "string",
  },
};

type argNames = keyof typeof cliOpts;

const validateBootArguments = (args: BootArguments) => {
  if (args.mode === "tui" && isEmpty(args.serverUrl.trim())) {
    throw new Error("TUI mode requires --server-url");
  }
};

export const parseArguments = (args: string[]): BootArguments => {
  const parsed = parseArgs({ args, options: cliOpts })
    .values as Partial<ParsedArguments>;

  if (parsed.version) {
    console.log(version);
    process.exit(0);
  }

  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  /* --- 整理解析后的参数值 --- */

  // 启动模式
  const mode = withDefault<string>(() => {
    const rawMode = parsed.mode;
    if (!isNullish(rawMode) && ["tui", "server", "both"].includes(rawMode)) {
      return rawMode;
    }
  }, "both");

  // 配置文件
  const config = withDefault<string>(parsed.config, () => {
    return `${process.cwd()}/config.json`;
  });

  // 项目工作目录
  const workspaceDir = withDefault<string>(
    () => {
      if (parsed.workspace) {
        let dir = parsed.workspace;
        if (!isAbsolute(dir)) {
          dir = resolve(process.cwd(), dir);
        }
        return dir;
      }
    },
    () => {
      return process.cwd();
    },
  );

  const sandboxDir = withDefault<string>(
    () => {
      if (parsed.sandbox) {
        return isAbsolute(parsed.sandbox)
          ? parsed.sandbox
          : `${workspaceDir}/${parsed.sandbox}`;
      }
    },
    () => {
      return `${workspaceDir}/sandbox`;
    },
  );

  const serverUrl = withDefault<string>(parsed["server-url"], "");
  const address = withDefault<string>(parsed.address, DEFAULT_HOST);
  const port = parsed.port ? Number(parsed.port) : undefined;

  /* --- 组装启动参数 --- */
  const bootArgs: BootArguments = {
    mode,
    config,
    workspace: workspaceDir,
    sandbox: sandboxDir,
    serverUrl,
    address,
    port,
  };

  validateBootArguments(bootArgs);

  return bootArgs;
};
