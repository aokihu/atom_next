import type { UUID } from "@/types";
import type { TransportEvent } from "@/core/transport";

type PipelineLifecycleEvent =
  | {
      type: "pipeline.started";
      pipeline: string;
      taskId: UUID;
      chainId: UUID;
      createdAt: number;
    }
  | {
      type: "pipeline.completed";
      pipeline: string;
      taskId: UUID;
      chainId: UUID;
      createdAt: number;
    }
  | {
      type: "pipeline.failed";
      pipeline: string;
      taskId: UUID;
      chainId: UUID;
      error: string;
      createdAt: number;
    }
  | {
      type: "pipeline.element.started";
      pipeline: string;
      element: string;
      taskId: UUID;
      chainId: UUID;
      createdAt: number;
    }
  | {
      type: "pipeline.element.completed";
      pipeline: string;
      element: string;
      taskId: UUID;
      chainId: UUID;
      createdAt: number;
    }
  | {
      type: "pipeline.element.failed";
      pipeline: string;
      element: string;
      taskId: UUID;
      chainId: UUID;
      error: string;
      createdAt: number;
    };

export type RuntimePipelineEvent = PipelineLifecycleEvent | TransportEvent;
