import type { MemoryScope } from "@/types";
import { TaskSource } from "@/types/task";
import type { RuntimeOutputBudget } from "@/services/runtime";
import type {
  RuntimeConversationContext,
  RuntimeContinuationContext,
  RuntimeFollowUpContext,
  RuntimeMemoryScopeContext,
} from "../context-manager";
import type { IntentExecutionPolicy } from "../user-intent/intent-policy";
import { sliceRecentAssistantOutput } from "../post-follow-up";

type RuntimeContextPromptInput = {
  sessionId: string;
  round: number;
  source: TaskSource;
  conversation: RuntimeConversationContext;
  continuation?: RuntimeContinuationContext;
  followUp?: RuntimeFollowUpContext;
  memory: Record<MemoryScope, RuntimeMemoryScopeContext>;
  outputBudget?: RuntimeOutputBudget | null;
  intentPolicyPrompt: string[];
};

const MEMORY_SCOPE_TAGS: Record<MemoryScope, "Core" | "Long" | "Short"> = {
  core: "Core",
  long: "Long",
  short: "Short",
};

export const convertConversationContextToPrompt = (
  conversation: RuntimeConversationContext,
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
  followUp?: RuntimeFollowUpContext,
  options: {
    continuation?: RuntimeContinuationContext;
    source: TaskSource;
  } = {
    source: TaskSource.EXTERNAL,
  },
) => {
  return !followUp
    ? []
    : (() => {
        const shouldCompressAccumulatedOutput =
          options.source === "internal" &&
          !!options.continuation &&
          options.continuation.updatedAt !== null &&
          followUp.chainRound !== null &&
          followUp.chainRound >= 1;

        const prompt = [
          "<FollowUp>",
          `CHAT_ID=${followUp.chatId}`,
          `CHAIN_ROUND=${followUp.chainRound ?? ""}`,
          "ORIGINAL_USER_INPUT<<EOF",
          followUp.originalUserInput,
          "EOF",
        ];

        if (shouldCompressAccumulatedOutput) {
          prompt.push(
            "ACCUMULATED_ASSISTANT_SUMMARY<<EOF",
            options.continuation?.summary ?? "",
            "EOF",
            "RECENT_ASSISTANT_OUTPUT<<EOF",
            sliceRecentAssistantOutput(followUp.accumulatedAssistantOutput),
            "EOF",
          );
        } else {
          prompt.push(
            "ACCUMULATED_ASSISTANT_OUTPUT<<EOF",
            followUp.accumulatedAssistantOutput,
            "EOF",
          );
        }

        prompt.push("</FollowUp>");
        return prompt;
      })();
};

export const convertContinuationContextToPrompt = (
  continuation?: RuntimeContinuationContext,
) => {
  return !continuation || continuation.updatedAt === null
    ? []
    : [
        "<Continuation>",
        `<Summary>${continuation.summary}</Summary>`,
        `<NextPrompt>${continuation.nextPrompt}</NextPrompt>`,
        `<AvoidRepeat>${continuation.avoidRepeat}</AvoidRepeat>`,
        "</Continuation>",
      ];
};

export const convertMemoryScopeContextToPrompt = (
  scope: MemoryScope,
  memoryContext: RuntimeMemoryScopeContext,
) => {
  const tag = MEMORY_SCOPE_TAGS[scope];

  if (memoryContext.status === "idle") {
    return [`<${tag}></${tag}>`];
  }

  const prompt = [`<${tag}>`, `<Status>${memoryContext.status}</Status>`];

  if (memoryContext.query !== "") {
    prompt.push(`<Query>${memoryContext.query}</Query>`);
  }

  if (memoryContext.reason !== "") {
    prompt.push(`<Reason>${memoryContext.reason}</Reason>`);
  }

  if (memoryContext.status === "loaded") {
    for (const output of memoryContext.outputs) {
      prompt.push(
        "<MemoryItem>",
        `<Key>${output.memory.key}</Key>`,
        "<Text>",
        output.memory.text,
        "</Text>",
        "<Meta>",
        `<CreatedAt>${output.memory.meta.created_at}</CreatedAt>`,
        `<UpdatedAt>${output.memory.meta.updated_at}</UpdatedAt>`,
        `<Score>${output.memory.meta.score}</Score>`,
        `<Status>${output.memory.meta.status}</Status>`,
        `<Confidence>${output.memory.meta.confidence}</Confidence>`,
        `<Type>${output.memory.meta.type}</Type>`,
        "</Meta>",
        "<Retrieval>",
        `<Mode>${output.retrieval.mode}</Mode>`,
        `<Relevance>${output.retrieval.relevance}</Relevance>`,
        `<Reason>${output.retrieval.reason}</Reason>`,
        "</Retrieval>",
      );

      if (output.links.length === 0) {
        prompt.push("<Links></Links>");
      } else {
        prompt.push("<Links>");

        for (const link of output.links) {
          prompt.push(
            "<Link>",
            `<TargetMemoryKey>${link.target_memory_key}</TargetMemoryKey>`,
            `<TargetSummary>${link.target_summary}</TargetSummary>`,
            `<LinkType>${link.link_type}</LinkType>`,
            `<Term>${link.term}</Term>`,
            `<Weight>${link.weight}</Weight>`,
            "</Link>",
          );
        }

        prompt.push("</Links>");
      }

      prompt.push("</MemoryItem>");
    }
  }

  prompt.push(`</${tag}>`);
  return prompt;
};

export const convertIntentPolicyToPrompt = (policy: IntentExecutionPolicy) => {
  if (policy.updatedAt === null) {
    return ["<IntentPolicy>", "</IntentPolicy>"];
  }

  const prompt = [
    "<IntentPolicy>",
    `SESSION_ID=${policy.sessionId}`,
    `ACCEPTED_INTENT_TYPE=${policy.acceptedIntentType}`,
    `PRELOAD_MEMORY=${policy.preloadMemory}`,
    `MEMORY_QUERY=${policy.memoryQuery}`,
    `ALLOW_MEMORY_SAVE=${policy.allowMemorySave}`,
    `MAX_FOLLOW_UP_ROUNDS=${policy.maxFollowUpRounds}`,
    `PROMPT_VARIANT=${policy.promptVariant}`,
    `PREDICTION_TRUST=${policy.predictionTrust}`,
    `MAX_OUTPUT_TOKENS=${policy.maxOutputTokens ?? ""}`,
    `REQUEST_TOKEN_RESERVE=${policy.requestTokenReserve ?? ""}`,
    `VISIBLE_OUTPUT_BUDGET=${policy.visibleOutputBudget ?? ""}`,
    `PREFER_EARLY_FOLLOW_UP=${policy.preferEarlyFollowUp}`,
    `IS_NEW_CHAT_IN_SESSION=${policy.isNewChatInSession}`,
  ];

  if (policy.responseStrategyText !== "") {
    prompt.push("RESPONSE_STRATEGY<<EOF", policy.responseStrategyText, "EOF");
  }

  prompt.push("</IntentPolicy>");
  return prompt;
};

export const convertOutputBudgetToPrompt = (
  outputBudget?: RuntimeOutputBudget | null,
) => {
  if (!outputBudget) {
    return [];
  }

  return [
    "<OutputBudget>",
    `MAX_OUTPUT_TOKENS=${outputBudget.maxOutputTokens}`,
    `REQUEST_TOKEN_RESERVE=${outputBudget.requestTokenReserve}`,
    `VISIBLE_OUTPUT_BUDGET=${outputBudget.visibleOutputBudget}`,
    "</OutputBudget>",
  ];
};

export const convertRuntimeContextToPrompt = (
  promptContext: RuntimeContextPromptInput,
) => {
  return [
    "<Context>",
    "<Meta>",
    `Session ID = ${promptContext.sessionId}`,
    `Time = ${new Date().toISOString()}`,
    `Round = ${promptContext.round}`,
    "</Meta>",
    "<Channel>",
    `Source = ${promptContext.source}`,
    "</Channel>",
    ...convertOutputBudgetToPrompt(promptContext.outputBudget),
    ...convertConversationContextToPrompt(promptContext.conversation),
    ...promptContext.intentPolicyPrompt,
    ...convertContinuationContextToPrompt(promptContext.continuation),
    "<Memory>",
    ...convertMemoryScopeContextToPrompt("core", promptContext.memory.core),
    ...convertMemoryScopeContextToPrompt("long", promptContext.memory.long),
    ...convertMemoryScopeContextToPrompt("short", promptContext.memory.short),
    "</Memory>",
    ...convertFollowUpContextToPrompt(promptContext.followUp, {
      continuation: promptContext.continuation,
      source: promptContext.source,
    }),
    "</Context>",
  ].join("\n");
};
