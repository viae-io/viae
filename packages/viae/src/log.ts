export interface LogFn {
  (msg: string): void
  (merge: (Error | any), msg: string): void
}

export type Log = {
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
};