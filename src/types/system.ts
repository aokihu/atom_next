/**
 * 系统运行时参数类型
 * @version 1.0.0
 */
export type SystemRuntimeParams = {
  // 工作目录
  workspace_dir: string;
  // 工作沙箱目录,通常是{workspace_dir}/sandbox
  sandbox_dir: string;
  // 核心服务器监听地址和端口
  server: {
    address: string;
    port: number;
  };
};
