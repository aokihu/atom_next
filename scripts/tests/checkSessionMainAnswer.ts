import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMessageText } from "../libs/http";
import { startCoreServer } from "../libs/server";
import { createSession, pollChatUntilSettled, submitTextChat } from "../libs/session";

const EXPECTED_TOKEN = "SESSION_MAIN_FLOW_OK";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const workspaceDir = join(repoRoot, "Playground");

const run = async () => {
  const server = await startCoreServer({
    repoRoot,
    workspaceDir,
  });

  try {
    console.log(`[session-test] starting server on ${server.baseUrl}`);

    const sessionId = await createSession(server.baseUrl);
    console.log(`[session-test] created session ${sessionId}`);

    const chatId = await submitTextChat(
      server.baseUrl,
      sessionId,
      `请直接回答并包含字符串 ${EXPECTED_TOKEN}，不要使用工具，不要添加与该字符串无关的解释。`,
    );
    console.log(`[session-test] submitted chat ${chatId}`);

    const result = await pollChatUntilSettled(server.baseUrl, sessionId, chatId);
    const answer = parseMessageText(result.message?.data);

    if (!answer.includes(EXPECTED_TOKEN)) {
      throw new Error(
        `Completed chat did not contain expected token. Answer: ${answer}`,
      );
    }

    console.log("[session-test] completed chat status:", result.chatStatus);
    console.log("[session-test] answer:", answer);
    console.log("[session-test] session main answer flow passed");
  } catch (error) {
    const { stdout, stderr } = await server.readOutputs();

    if (stdout.trim() !== "") {
      console.error("[session-test] server stdout:\n" + stdout);
    }

    if (stderr.trim() !== "") {
      console.error("[session-test] server stderr:\n" + stderr);
    }

    throw error;
  } finally {
    await server.stop();
  }
};

await run();
