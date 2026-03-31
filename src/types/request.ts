/**
 * 请求体类型
 * @description
 * 定义外部 API 请求进入系统时使用的数据结构。
 */

import type { TaskChannel, TaskPayload } from "./task";

export type ChatSubmissionBody = {
  payload: TaskPayload;
  priority?: number;
  channel?: TaskChannel;
};
