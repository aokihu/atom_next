/**
 * Asset Module Types
 * @author aokihu <aokihu@gmail.com>
 * @version 0.5.1
 * @description 声明静态资源模块类型，供编译期导入 md 和 json 资源使用。
 */

declare module "*.md" {
  const value: string;
  export default value;
}

declare module "*.json" {
  const value: Record<string, unknown>;
  export default value;
}
