/**
 * intent-request/types.ts
 * @description
 * 统一定义 intent-request 子域内部使用的辅助类型。
 *
 * 这个文件只负责类型声明，
 * 不放解析逻辑、分发逻辑或执行逻辑。
 */
import type { MemoryService } from "@/services";
import type {
  FollowUpWithToolsEndIntentRequestParams,
  FollowUpWithToolsFinishedIntentRequestParams,
  FollowUpWithToolsIntentRequestParams,
  MemoryScope,
} from "@/types";
import type { IntentExecutionPolicy } from "../user-intent";
import type { RuntimeMemoryItem } from "../memory-item";

/* ==================== */
/* Parse Types          */
/* ==================== */

export type RawIntentRequestParams = Record<string, string>;

/* ==================== */
/* Execution Types      */
/* ==================== */

export type IntentRequestExecutionResult =
  | {
      status: "continue";
    }
  | {
      status: "stop";
      nextState?: import("@/types/task").TaskState;
      nextTask?: import("@/types/task").TaskItem;
    };

export type RuntimeIntentRequestExecutionContext = {
  memory: MemoryService;
  getMemoryContext: (
    scope: MemoryScope,
  ) => {
    status: "idle" | "loaded" | "empty";
    query: string;
  };
  recordMemorySearchResult: (
    scope: MemoryScope,
    options: {
      words: string;
      outputs: RuntimeMemoryItem[];
      reason?: string;
    },
  ) => void;
  setMemoryContext: (
    scope: MemoryScope,
    outputs: RuntimeMemoryItem[],
    options?: {
      query?: string;
      reason?: string;
    },
  ) => void;
  getLoadedMemoryScopeByKey: (memoryKey: string) => MemoryScope | null;
  unloadMemoryContextByKey: (memoryKey: string) => boolean;
  setIntentPolicy: (
    sessionId: string,
    policy: Omit<IntentExecutionPolicy, "updatedAt">,
  ) => void;
  setContinuationContext: (
    input: FollowUpWithToolsIntentRequestParams,
  ) => void;
  activateToolContext: () => void;
  setToolContextMode: (
    mode: "active" | "finished" | "ended",
  ) => void;
  appendToolResult: (input: {
    toolName: string;
    toolCallId?: string;
    toolInput: unknown;
    ok: boolean;
    result?: unknown;
    error?: string;
    reusable?: boolean;
  }) => void;
  removeToolResult: (key: string) => boolean;
  clearToolContext: () => void;
  hasActiveToolContext: () => boolean;
  setFinishedContinuationContext: (
    input: FollowUpWithToolsFinishedIntentRequestParams,
  ) => void;
  recordToolEnd: (
    input: FollowUpWithToolsEndIntentRequestParams,
  ) => void;
};
