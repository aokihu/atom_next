export enum WatchmanWorkerSignal {
  START = "start",
  STOP = "stop",
  CHANGED = "changed",
  ERROR = "error",
}

export type WatchmanWorkerControlMessage =
  | {
      type: WatchmanWorkerSignal.START;
      workspace: string;
    }
  | {
      type: WatchmanWorkerSignal.STOP;
    };

export type WatchmanWorkerEventMessage =
  | {
      type: WatchmanWorkerSignal.CHANGED;
    }
  | {
      type: WatchmanWorkerSignal.ERROR;
      error: string;
    };
