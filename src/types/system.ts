/**
 * 系统运行时参数类型
 * @description
 * 描述应用运行时需要的基础目录和服务监听配置。
 */

export type SystemRuntimeParams = {
  /* ==================== */
  /* Workspace            */
  /* ==================== */

  // 工作目录
  workspace_dir: string;

  // 工作沙箱目录,通常是{workspace_dir}/sandbox
  sandbox_dir: string;

  /* ==================== */
  /* Server               */
  /* ==================== */

  // 核心服务器监听地址和端口
  server: {
    address: string;
    port: number;
  };
};
