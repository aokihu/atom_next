import { describe, expect, test } from "bun:test";

import { disableAISDKWarningLogs } from "@/bootstrap/ai-sdk";

describe("disableAISDKWarningLogs", () => {
  test("sets AI_SDK_LOG_WARNINGS global to false", () => {
    delete (globalThis as typeof globalThis & {
      AI_SDK_LOG_WARNINGS?: false;
    }).AI_SDK_LOG_WARNINGS;

    disableAISDKWarningLogs();

    expect((globalThis as typeof globalThis & {
      AI_SDK_LOG_WARNINGS?: false;
    }).AI_SDK_LOG_WARNINGS).toBe(false);
  });
});
