export enum WatchmanPhase {
  IDLE = "idle",
  COMPILING = "compiling",
  READY = "ready",
  ERROR = "error",
}

export type WatchmanStatus = {
  phase: WatchmanPhase;
  hash: string | null;
  updatedAt: number | null;
  error: string | null;
};

export type WatchmanMetaEntry = {
  compiledFile: string;
  compiledAt: number;
};

export type WatchmanMeta = {
  version: number;
  currentHash: string | null;
  updatedAt: number | null;
  entries: Record<string, WatchmanMetaEntry>;
};
