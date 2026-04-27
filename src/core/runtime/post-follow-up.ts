import { isEmpty } from "radashi";
import { z } from "zod";
import {
  MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH,
  MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH,
  MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH,
} from "@/core/runtime/intent-request/safety/shared";
import postFollowUpPromptText from "@/assets/prompts/post_follow_up_prompt.md" with { type: "text" };

export const POST_FOLLOW_UP_MAX_OUTPUT_TOKENS = 160;
export const POST_FOLLOW_UP_RECENT_OUTPUT_MAX_CHARS = 2000;
const POST_FOLLOW_UP_FALLBACK_SUMMARY_MAX_CHARS = 240;
const DEFAULT_POST_FOLLOW_UP_NEXT_PROMPT =
  "基于当前 FollowUp 上下文继续当前回答，不要重复前文。";
const DEFAULT_POST_FOLLOW_UP_AVOID_REPEAT = "不要重复已经输出的内容。";

export type PostFollowUpContinuation = {
  summary: string;
  nextPrompt: string;
  avoidRepeat: string;
};

export const PostFollowUpContinuationSchema = z.object({
  summary: z.string().optional(),
  nextPrompt: z.string().optional(),
  avoidRepeat: z.string().optional(),
}).passthrough();

const clampText = (text: string, maxLength: number) => {
  const normalized = text.trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength).trim();
};

export const sliceRecentAssistantOutput = (
  output: string,
  maxChars = POST_FOLLOW_UP_RECENT_OUTPUT_MAX_CHARS,
) => {
  if (output.length <= maxChars) {
    return output;
  }

  return output.slice(-maxChars);
};

export const exportPostFollowUpPrompt = () => {
  return postFollowUpPromptText.trim();
};

export const exportPostFollowUpUserPrompt = (input: {
  originalUserInput: string;
  rawFollowUpIntent: string;
  chainRound: number | null;
  recentAssistantOutput: string;
}) => {
  return [
    "<PostFollowUpInput>",
    `<Meta>${JSON.stringify({ chainRound: input.chainRound ?? null })}</Meta>`,
    "<OriginalUserInput>",
    input.originalUserInput.trim(),
    "</OriginalUserInput>",
    "<RawFollowUpIntent>",
    input.rawFollowUpIntent.trim(),
    "</RawFollowUpIntent>",
    "<RecentAssistantOutput>",
    input.recentAssistantOutput,
    "</RecentAssistantOutput>",
    "</PostFollowUpInput>",
  ].join("\n");
};

export const normalizePostFollowUpContinuation = (
  input: z.infer<typeof PostFollowUpContinuationSchema>,
): PostFollowUpContinuation | null => {
  const summary = clampText(
    String(input.summary ?? ""),
    MAX_FOLLOW_UP_WITH_TOOLS_SUMMARY_LENGTH,
  );
  const nextPrompt = clampText(
    String(input.nextPrompt ?? ""),
    MAX_FOLLOW_UP_WITH_TOOLS_NEXT_PROMPT_LENGTH,
  );
  const avoidRepeat = clampText(
    String(input.avoidRepeat ?? ""),
    MAX_FOLLOW_UP_WITH_TOOLS_AVOID_REPEAT_LENGTH,
  );

  if (isEmpty(summary) || isEmpty(nextPrompt)) {
    return null;
  }

  return {
    summary,
    nextPrompt,
    avoidRepeat,
  };
};

export const createFallbackPostFollowUpContinuation = (
  rawFollowUpIntent: string,
): PostFollowUpContinuation => {
  const fallbackSummary = clampText(
    rawFollowUpIntent,
    POST_FOLLOW_UP_FALLBACK_SUMMARY_MAX_CHARS,
  );

  return {
    summary: isEmpty(fallbackSummary) ? "继续当前回答。" : fallbackSummary,
    nextPrompt: DEFAULT_POST_FOLLOW_UP_NEXT_PROMPT,
    avoidRepeat: DEFAULT_POST_FOLLOW_UP_AVOID_REPEAT,
  };
};
