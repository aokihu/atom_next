/**
 * Task 领域类型
 * @description
 * 定义任务来源、状态、输入负载和运行时任务模型。
 */

import type { UUID } from "./primitive";
import type { EventEmitter } from "events";

/* ==================== */
/* Enums                */
/* ==================== */

export enum TaskSource {
  EXTERNAL = "external",
  INTERNAL = "internal",
}

export enum TaskWorkflow {
  PREDICT_USER_INTENT = "predict_user_intent",
  POST_FOLLOW_UP = "post_follow_up",
  FORMAL_CONVERSATION = "formal_conversation",
}

export enum TaskState {
  WAITING = "waiting", // 任务进入到队列排队
  PENDING = "pending", // 任务正在被Core Runtime处理,准备数据提交等待上传
  PROCESSING = "processing", // 任务正在被Core Runtime处理,正在被transport上传到LLM执行
  COMPLETE = "complete", // 任务已完成
  FAILED = "failed", // 任务执行失败
  FOLLOW_UP = "follow_up", // 任务没有办法一次性完成执行,需要跟进任务
}

/* ==================== */
/* Input Models         */
/* ==================== */

export type TaskPayload = Array<
  | {
      type: "text";
      data: string;
    }
  | {
      type: "image";
      data?: any; // 图片二进制数据,或者base64格式数据
      url?: string; // 图片文件的有效的url地址
    }
  | {
      type: "audio";
      data?: any; // 音频二进制数据,或者base64格式地址
      url?: string; // 音频文件的有效url地址
    }
>;

export type TaskChannel =
  | {
      domain: "tui";
    }
  | {
      domain: "gateway";
      source: string; // 这里记录的是gateway客户端的识别名称,由gateway提供并维护
      metadata?: Record<string, string>; // gateway客户端传入的元数据,有gateway client发送,并不对此过滤,但是只能是string:string的格式
    };

type SettableTaskItemKeys = "updatedAt" | "state";

/**
 * 任务链路说明
 * @description
 * chainId 用于追踪同一条连续任务链。
 * parentId 指向直接上游任务，用于还原派生或续跑关系。
 * 根任务默认复用自身 id 作为 parentId。
 */

/* ==================== */
/* Core Models          */
/* ==================== */

export type RawTaskItem = {
  /* --- 任务身份ID --- */
  id: UUID; // 任务的ID,使用UUID格式,每个任务都是独立不相同的
  chainId: UUID; // 链式任务ID,比如会话太长需要继续执行,那么可以根据这个id推断出主任务,默认值与id相同
  chain_round?: number; // 可选的内部连续会话轮次,只在FOLLOW_UP链路中使用
  parentId: UUID | undefined; // 父任务ID,根任务默认与id一致,派生任务记录直接上游任务ID
  sessionId: UUID; // 会话ID
  chatId: UUID; // 会话中对话ID
  /* --- 任务状态 --- */
  state: TaskState;
  /* --- 任务元数据 --- */
  source: TaskSource; // 任务来源,区分内源任务还是外源任务
  workflow: TaskWorkflow; // workflow 类型,用于让 Core 选择处理流程
  priority: number; // 队列项目优先级,数字越小优先级越高,默认为2
  /* --- 用户输入 --- */
  eventTarget: EventEmitter | undefined; // HTTP API 的事件出发对象,通过这个对象当task发生变化,或者输出改变的时候触发
  channel: TaskChannel;
  payload: TaskPayload; // 队列项目中的负载数据,这些数据来自于用户的输入,格式可以是文本或者图片;也可以来自core内部的提示消息
  /* --- 任务时间 --- */
  createdAt: number; // 任务创建的时间,可用于调试
  updatedAt: number; // 任务更新的时间,可用于调试
};

/**
 * 创建任务时所需的最小输入
 * @description
 * 只暴露构造外部任务时允许由调用方传入的字段。
 */
export type TaskItemInput = Pick<RawTaskItem, "sessionId" | "chatId"> &
  Partial<
    Pick<
      RawTaskItem,
      "priority" | "payload" | "eventTarget" | "channel" | "workflow"
    >
  >;

/**
 * 创建内部任务时所需的最小输入
 * @description
 * 内部任务必须显式提供链路信息，
 * 这样 Core 才能根据 parentId / chainId 还原派生关系。
 */
export type InternalTaskItemInput = Pick<
  RawTaskItem,
  "sessionId" | "chatId" | "chainId" | "parentId"
> &
  Partial<
    Pick<
      RawTaskItem,
      | "chain_round"
      | "priority"
      | "payload"
      | "eventTarget"
      | "channel"
      | "workflow"
    >
  >;

export type TaskItems = Array<TaskItem>;

/**
 * 运行中的任务对象
 * @description
 * 默认字段只读，只允许在运行时修改 updatedAt 和 state。
 */
export type TaskItem = {
  readonly [K in Exclude<
    keyof RawTaskItem,
    SettableTaskItemKeys
  >]: RawTaskItem[K];
} & {
  updatedAt: number;
  state: TaskState;
};
