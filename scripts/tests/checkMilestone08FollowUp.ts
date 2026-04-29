import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { ServiceManager } from "@/libs/service-manage";
import { createTaskItem } from "@/libs/task";
import { Core } from "@/core";
import { Transport } from "@/core/transport";
import { RuntimeService } from "@/services/runtime";
import { WatchmanPhase } from "@/services/watchman/types";
import { ChatEvents } from "@/types/event";

const TEST_TIMEOUT_MS = 5_000;
const EXTERNAL_USER_INPUT = "请分两段回答这个问题";
const FOLLOW_UP_INTENT = "已完成第一段，下一轮继续输出第二段";
const FIRST_SEGMENT = "第一段";
const SECOND_SEGMENT = "第二段";
const FOLLOW_UP_OUTPUT_PREFIX = "[Contune] ";

type ObservedEvent =
  | {
      type: "chunk";
      sessionId: string;
      chatId: string;
      chunk: unknown;
    }
  | {
      type: "complete";
      sessionId: string;
      chatId: string;
      message: unknown;
    };

type SendCall = {
  systemPrompt: string;
  userPrompt: string;
};

const waitForCompletion = (eventTarget: EventEmitter) => {
  return new Promise<{
    sessionId: string;
    chatId: string;
    message: {
      createdAt: number;
      data: unknown;
    };
  }>((resolveCompletion, rejectCompletion) => {
    const timer = setTimeout(() => {
      rejectCompletion(new Error("FOLLOW_UP script timed out before completion"));
    }, TEST_TIMEOUT_MS);

    eventTarget.once(ChatEvents.CHAT_COMPLETED, (payload) => {
      clearTimeout(timer);
      resolveCompletion(payload as {
        sessionId: string;
        chatId: string;
        message: {
          createdAt: number;
          data: unknown;
        };
      });
    });
  });
};

const main = async () => {
  const projectRoot = resolve(import.meta.dir, "..", "..");
  const serviceManager = new ServiceManager();
  const runtimeService = new RuntimeService();
  const eventTarget = new EventEmitter();
  const sendCalls: SendCall[] = [];
  const observedEvents: ObservedEvent[] = [];
  const originalSend = Transport.prototype.send;

  runtimeService.setUserAgentPrompt("");
  runtimeService.setUserAgentPromptStatus({
    phase: WatchmanPhase.READY,
    hash: null,
    updatedAt: Date.now(),
    error: null,
  });
  serviceManager.register(runtimeService);

  Transport.prototype.send = async function (
    systemPrompt,
    userPrompt,
    options = {},
  ) {
    sendCalls.push({
      systemPrompt,
      userPrompt,
    });

    if (sendCalls.length === 1) {
      await options.onTextDelta?.(FIRST_SEGMENT);

      return {
        text: FIRST_SEGMENT,
        intentRequestText: `[FOLLOW_UP, "${FOLLOW_UP_INTENT}", sessionId=session-1;chatId=chat-1]`,
        finishReason: "stop",
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: 20,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined,
          },
        },
        totalUsage: {
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: 20,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined,
          },
        },
      };
    }

    await options.onTextDelta?.(SECOND_SEGMENT);

    return {
      text: SECOND_SEGMENT,
      intentRequestText: "",
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      totalUsage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    };
  };

  try {
    const core = new Core(serviceManager);
    const originalRunloop = core.runloop.bind(core);
    let runloopCount = 0;

    // Core 的 runloop 默认会持续空转。
    // 这里把验证范围限制在“外部任务 + 一次 follow_up 内部任务”两轮内，
    // 避免脚本在验证完成后继续进入空轮询。
    core.runloop = async function () {
      runloopCount += 1;

      if (runloopCount <= 2) {
        return await originalRunloop();
      }
    };

    eventTarget.on(ChatEvents.CHAT_OUTPUT_UPDATED, (payload) => {
      observedEvents.push({
        type: "chunk",
        sessionId: payload.sessionId,
        chatId: payload.chatId,
        chunk: payload.delta,
      });
    });

    eventTarget.on(ChatEvents.CHAT_COMPLETED, (payload) => {
      observedEvents.push({
        type: "complete",
        sessionId: payload.sessionId,
        chatId: payload.chatId,
        message: payload.message.data,
      });
    });

    const completionPromise = waitForCompletion(eventTarget);

    await core.addTask(
      createTaskItem({
        sessionId: "session-1",
        chatId: "chat-1",
        eventTarget,
        payload: [
          {
            type: "text",
            data: EXTERNAL_USER_INPUT,
          },
        ],
      }),
    );

    await core.runloop();
    const completedPayload = await completionPromise;

    assert.equal(sendCalls.length, 2, "FOLLOW_UP should trigger exactly two sends");
    assert.equal(
      sendCalls[0]?.userPrompt,
      EXTERNAL_USER_INPUT,
      "first round should submit original user input",
    );
    assert.equal(
      sendCalls[1]?.userPrompt,
      FOLLOW_UP_INTENT,
      "second round should submit follow up intent only",
    );
    assert.equal(
      observedEvents.filter((item) => item.type === "complete").length,
      1,
      "chat should complete exactly once",
    );
    assert.deepEqual(
      observedEvents.map((item) => item.type),
      ["chunk", "chunk", "complete"],
      "chat should not complete between follow up rounds",
    );

    for (const event of observedEvents) {
      assert.equal(event.sessionId, "session-1");
      assert.equal(event.chatId, "chat-1");
    }

    assert.equal(
      observedEvents[1]?.type === "chunk" ? observedEvents[1].chunk : undefined,
      `${FOLLOW_UP_OUTPUT_PREFIX}${SECOND_SEGMENT}`,
      "follow up output should start with the continuation prefix",
    );
    assert.equal(
      completedPayload.message.data,
      `${FIRST_SEGMENT}${FOLLOW_UP_OUTPUT_PREFIX}${SECOND_SEGMENT}`,
      "final message should be the accumulated assistant output",
    );

    console.log("Milestone 0.8 FOLLOW_UP check passed");
    console.log(`Project: ${projectRoot}`);
    console.log(`Session: ${completedPayload.sessionId}`);
    console.log(`Chat: ${completedPayload.chatId}`);
    console.log(`Send count: ${sendCalls.length}`);
    console.log(`Observed events: ${observedEvents.map((item) => item.type).join(" -> ")}`);
    console.log(`Final message: ${String(completedPayload.message.data)}`);
  } finally {
    Transport.prototype.send = originalSend;
  }
};

await main();
