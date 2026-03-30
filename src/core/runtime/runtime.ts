import type { UUID, ISOTimeString, EmptyString } from "@/types";
import { TaskSource, type TaskItem } from "@/types/queue";

/**
 * ISO 8601 标准时间格式类型
 * 格式: YYYY-MM-DDTHH:mm:ss.sssZ
 * 例如: 2024-01-01T12:00:00.000Z
 */

type RuntimeContext = {
  meta: {
    sessionId: UUID | EmptyString; // 会话的标识
    round: number; // 会话的轮数,计数从1开始
  };
  channel: {
    source: TaskSource;
  };
  memory: {
    core: any[];
    short: any[];
    long: any[];
  };
};

export class Runtime {
  #currentTask: TaskItem | null = null;
  #taskSessions: {
    id: UUID;
    round: number;
  }[];
  #context: RuntimeContext;

  constructor() {
    // [Milestone 0.1]
    // 这里暂时不对session数组做任何处理
    this.#taskSessions = [];

    this.#context = {
      meta: {
        sessionId: "",
        round: 1,
      },
      channel: {
        source: TaskSource.EXTERNAL,
      },
      memory: {
        core: [],
        short: [],
        long: [],
      },
    } satisfies RuntimeContext;
  }

  /**
   * 将RuntimeContext转换成提示词格式
   */
  #convertContextToPrompt() {
    const prompt = [
      "<Context>",
      // 会话元数据
      "<Meta>",
      `Session ID = ${this.#context.meta.sessionId}`,
      `Time = ${new Date().toISOString()}`,
      `Round = ${this.#context.meta.round}`,
      "</Meta>",
      // 会话通道数据
      "<Channel>",
      `Source = ${this.#context.channel.source}`,
      "</Channel>",
      // 记忆数据
      "<Memory>",
      "<Core></Core>",
      "<Long></Long>",
      "<Short></Short>",
      "</Memory>",
      "</Context>",
    ];

    return prompt.join("\n");
  }

  /**
   * 将任务中用户的传入信息转化成提示词
   */
  #convertTaskToPrompt() {
    const task = this.#currentTask;
    return [].join("\n");
  }

  /**
   * 输出提示词
   * @description 整合RuntimeContext和用户输入的完整的会话提示词
   */
  public exportPrompt() {
    const runtimePrompt = this.#convertContextToPrompt();
    const taskPrompt = this.#convertTaskToPrompt();
  }
}
