import type { UUID } from "@/types";

export type TransportEvent =
  | {
      type: "transport.delta";
      taskId: UUID;
      chainId: UUID;
      delta: string;
      createdAt: number;
    }
  | {
      type: "transport.tool.started";
      taskId: UUID;
      chainId: UUID;
      event: unknown;
      createdAt: number;
    }
  | {
      type: "transport.tool.finished";
      taskId: UUID;
      chainId: UUID;
      event: unknown;
      createdAt: number;
    }
  | {
      type: "transport.failed";
      taskId: UUID;
      chainId: UUID;
      error: string;
      createdAt: number;
    };
