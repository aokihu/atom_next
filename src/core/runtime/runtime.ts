import type { UUID, ISOTimeString, EmptyString } from "@/types";
import { TaskSource, type TaskItem } from "@/types/task";
import type { PathLike } from "bun";

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
  #systemRules: string;

  constructor() {
    // [Milestone 0.1]
    // 这里暂时不对session数组做任何处理
    this.#taskSessions = [];

    // 系统规则提示词
    this.#systemRules = "";

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
   * 将任务转化成提示词
   * @description 从task.payload字段中提取用户的输入信息
   *              整理之后输出,当前只出了文本格式的数据
   */
  #convertTaskToPrompt() {
    const { payload } = this.#currentTask as TaskItem;
    return payload
      .filter((p) => p.type === "text")
      .map((p) => p.data)
      .join("\n");
  }

  /* ==================== */
  /* Public getter/setter */
  /* ==================== */

  set currentTask(task: TaskItem) {
    this.#currentTask = task;
  }

  /* ==================== */
  /*   Public Methods     */
  /* ==================== */

  /**
   * 从文件中加载系统规则
   * @param file 系统规则文件路径
   */
  public async loadSystemRules(file: string) {
    if (await Bun.file(file).exists()) {
      const content = await Bun.file(file).text();
      this.#systemRules = content;
    } else {
      this.#systemRules = "";
      throw new Error(`System rules file not found: ${file}`);
    }
  }

  /**
   * 输出系统提示词
   * @description 输出来自Runtime Context的数据和系统内部强制规范提示词文本
   * @returns 系统提示词文本
   */
  public exportSystemPrompt(): string {
    const runtimePrompt = this.#convertContextToPrompt();
    return `${this.#systemRules}\n${runtimePrompt}`;
  }

  /**
   * 输出用户输入提示词
   * @returns 用户输入提示词文本
   */
  public exportUserPrompt(): string {
    return this.#convertTaskToPrompt();
  }

  /**
   * 输出提示词
   * @returns 返回一个数组,第一个元素是系统提示词,第二个元素是用户提示词
   */
  public exportPrompts(): [string, string] {
    const systemPrompt = this.exportSystemPrompt();
    const userPrompt = this.exportUserPrompt();
    return [systemPrompt, userPrompt];
  }

  /**
   * 解析LLM返回的Request请求
   * @param requestText LLM返回的Request请求
   */
  public parseLLMRequest(requestText: string) {}
}
