/**
 * 创建日期: 2026-03-17
 * 修改日期: 2026-03-17
 * 文件描述: 声明静态文本资源模块类型,供编译期文本导入使用。
 */

declare module "*.md" {
  const value: string;
  export default value;
}
