type Source = "external" | "internal"; // 任务来源,来自于core的是内部,除此以外都是外部来源

type Payload =
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
    };

type Channel =
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
 * [链式任务说明]
 * 当一个任务因为某些原因需要分成多个会话才能完成
 * 这时候就需要有一个方法来跟踪这个多步骤进行
 * chainId 始终与初始任务ID一致
 * parentId 始终与上一轮任务的ID一致
 * 这样就能清除的跟踪任务的产生与消费
 *
 * 初始: {id: ID1, chainId: ID1}
 * 第一轮: {id: ID2, chainId: ID1, parentId: ID1}
 * 第二轮: {id: ID3, chainId: ID1, parentId: ID2}
 * 最终轮: {id: ID4, chainId: ID1, parentId: ID3}
 *
 * [派生任务说明]
 * 派生任务与链式任务的不同点是,派生任务的chainId始终与自身id一致
 *
 * 初始: {id: ID1, chainId: ID1}
 * 第一轮: {id: ID2, chainId: ID2, parentId: ID1}
 * 最终轮: {id: ID3, chainId: ID3, parentId: ID2}
 */

export type RawTaskItem = {
  /* --- 任务身份ID --- */
  id: string; // 任务的ID,使用UUID格式,每个任务都是独立不相同的
  chainId: string; // 链式任务ID,比如会话太长需要继续执行,那么可以根据这个id推断出主任务,默认值与id相同
  parentId: string | undefined; // 父任务ID,如果有派生任务那么记录父任务的ID,如果没有则为undfiend
  sessionId: string; // 会话ID
  chatId: string; // 会话中对话ID
  /* --- 任务状态 --- */
  state: string;
  /* --- 任务元数据 --- */
  source: Source; // 任务来源,区分内源任务还是外源任务
  priority: number; // 队列项目优先级,数字越小优先级越高,默认为2
  /* --- 用户输入 --- */
  eventTarget: EventTarget | undefined; // HTTP API 的事件出发对象,通过这个对象当task发生变化,或者输出改变的时候触发
  channel: Channel;
  payload: Payload[]; // 队列项目中的负载数据,这些数据来自于用户的输入,格式可以是文本或者图片;也可以来自core内部的提示消息
  /* --- 任务时间 --- */
  createdAt: number; // 任务创建的时间,可用于调试
  updatedAt: number; // 任务更新的时间,可用于调试
};

export type TaskItems = Array<TaskItem>;

/**
 * 对外使用的TaskItem类型
 * 只读的 TaskItem 类型，只允许修改 updatedAt 和 state
 */
export type TaskItem = {
  readonly [K in Exclude<
    keyof RawTaskItem,
    SettableTaskItemKeys
  >]: RawTaskItem[K];
} & {
  updatedAt: number;
  state: string;
};
