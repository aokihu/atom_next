import type {
  LinkType,
  MemoryOutput,
  MemoryRetrieval,
  MemoryStatus,
  MemoryType,
} from "@/types";

export type RuntimeMemoryLink = {
  target_memory_key: string;
  target_summary: string;
  link_type: LinkType;
  term: string;
  weight: number;
};

export type RuntimeMemoryItem = {
  memory: {
    key: string;
    text: string;
    meta: {
      created_at: number;
      updated_at: number;
      score: number;
      status: MemoryStatus;
      confidence: number;
      type: MemoryType;
    };
  };
  retrieval: MemoryRetrieval;
  links: RuntimeMemoryLink[];
};

export const createRuntimeMemoryItem = (
  output: MemoryOutput,
  options: {
    retrieval?: MemoryRetrieval;
  } = {},
): RuntimeMemoryItem => {
  return {
    memory: {
      key: output.memory.memory_key,
      text: output.memory.text,
      meta: {
        created_at: output.memory.created_at,
        updated_at: output.memory.updated_at,
        score: output.memory.score,
        status: output.memory.status,
        confidence: output.memory.confidence,
        type: output.memory.type,
      },
    },
    retrieval: options.retrieval ?? output.retrieval,
    links: output.links.map((link) => {
      return {
        target_memory_key: link.target_memory_key,
        target_summary: link.target_summary,
        link_type: link.link_type,
        term: link.term,
        weight: link.weight,
      };
    }),
  };
};
