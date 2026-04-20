import type { IntentExecutionPolicy } from "./intent-policy";

type RuntimeConversationPromptContext = {
  lastUserInput: string;
  lastAssistantOutput: string;
  updatedAt: number | null;
};

type RuntimeFollowUpPromptContext = {
  chatId: string;
  chainRound: number | null;
  originalUserInput: string;
  accumulatedAssistantOutput: string;
};

export const convertConversationContextToPrompt = (
  conversation: RuntimeConversationPromptContext,
) => {
  return conversation.updatedAt === null
    ? ["<Conversation>", "STATE=empty", "</Conversation>"]
    : [
        "<Conversation>",
        "LAST_USER_INPUT<<EOF",
        conversation.lastUserInput,
        "EOF",
        "LAST_ASSISTANT_OUTPUT<<EOF",
        conversation.lastAssistantOutput,
        "EOF",
        "</Conversation>",
      ];
};

export const convertFollowUpContextToPrompt = (
  followUp?: RuntimeFollowUpPromptContext,
) => {
  return !followUp
    ? []
    : [
        "<FollowUp>",
        `CHAT_ID=${followUp.chatId}`,
        `CHAIN_ROUND=${followUp.chainRound ?? ""}`,
        "ORIGINAL_USER_INPUT<<EOF",
        followUp.originalUserInput,
        "EOF",
        "ACCUMULATED_ASSISTANT_OUTPUT<<EOF",
        followUp.accumulatedAssistantOutput,
        "EOF",
        "</FollowUp>",
      ];
};

export const convertIntentPolicyToPrompt = (policy: IntentExecutionPolicy) => {
  return policy.updatedAt === null
    ? ["<IntentPolicy>", "</IntentPolicy>"]
    : [
        "<IntentPolicy>",
        `SESSION_ID=${policy.sessionId}`,
        `ACCEPTED_INTENT_TYPE=${policy.acceptedIntentType}`,
        `PRELOAD_MEMORY=${policy.preloadMemory}`,
        `MEMORY_QUERY=${policy.memoryQuery}`,
        `ALLOW_MEMORY_SAVE=${policy.allowMemorySave}`,
        `MAX_FOLLOW_UP_ROUNDS=${policy.maxFollowUpRounds}`,
        `PROMPT_VARIANT=${policy.promptVariant}`,
        `PREDICTION_TRUST=${policy.predictionTrust}`,
        "</IntentPolicy>",
      ];
};
