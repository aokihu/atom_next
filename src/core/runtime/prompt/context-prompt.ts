import type { MemoryScope } from "@/types";
import type { TaskSource } from "@/types/task";
import type {
  RuntimeConversationContext,
  RuntimeContinuationContext,
  RuntimeFollowUpContext,
  RuntimeMemoryScopeContext,
} from "../context-manager";
import type { IntentExecutionPolicy } from "../user-intent/intent-policy";

type RuntimeContextPromptInput = {
  sessionId: string;
  round: number;
  source: TaskSource;
  conversation: RuntimeConversationContext;
  continuation?: RuntimeContinuationContext;
  followUp?: RuntimeFollowUpContext;
  memory: Record<MemoryScope, RuntimeMemoryScopeContext>;
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
    ...convertConversationContextToPrompt(promptContext.conversation),
    ...promptContext.intentPolicyPrompt,
    ...convertContinuationContextToPrompt(promptContext.continuation),
    "<Memory>",
    ...convertMemoryScopeContextToPrompt("core", promptContext.memory.core),
    ...convertMemoryScopeContextToPrompt("long", promptContext.memory.long),
    ...convertMemoryScopeContextToPrompt("short", promptContext.memory.short),
    "</Memory>",
    ...convertFollowUpContextToPrompt(promptContext.followUp),
    "</Context>",
  ].join("\n");
};
