type LogFn = {
  (msg: string, ...args: unknown[]): void;
  (obj: object, msg?: string, ...args: unknown[]): void;
};

export interface Log {
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
}

function makeLogFn(fn: (...args: unknown[]) => void): LogFn {
  return function (objOrMsg: object | string, ...rest: unknown[]): void {
    if (typeof objOrMsg === "string") {
      fn(objOrMsg, ...rest);
    } else {
      fn(String(rest[0] ?? ""), objOrMsg, ...rest.slice(1));
    }
  } as LogFn;
}

export const consoleLog: Log = {
  trace: makeLogFn(console.debug.bind(console)),
  debug: makeLogFn(console.debug.bind(console)),
  info: makeLogFn(console.info.bind(console)),
  warn: makeLogFn(console.warn.bind(console)),
  error: makeLogFn(console.error.bind(console)),
  fatal: makeLogFn(console.error.bind(console)),
};
