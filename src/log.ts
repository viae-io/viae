import { debug } from "util";

export interface Log {
  debug(message: String, ...args): void;
  info(message: String, ...args): void;
  warn(message: String, ...args): void;
  error(message: String, err: Error, ...args): void;
  fatal(message: String, err: Error, ...args): void;
}

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  Fatal = 4,
}

enum CC {
  Reset = "\x1b[0m",
  Bright = "\x1b[1m",
  Dim = "\x1b[2m",
  Underscore = "\x1b[4m",
  Blink = "\x1b[5m",
  Reverse = "\x1b[7m",
  Hidden = "\x1b[8m",

  FgBlack = "\x1b[30m",
  FgRed = "\x1b[31m",
  FgGreen = "\x1b[32m",
  FgYellow = "\x1b[33m",
  FgBlue = "\x1b[34m",
  FgMagenta = "\x1b[35m",
  FgCyan = "\x1b[36m",
  FgWhite = "\x1b[37m",

  BgBlack = "\x1b[40m",
  BgRed = "\x1b[41m",
  BgGreen = "\x1b[42m",
  BgYellow = "\x1b[43m",
  BgBlue = "\x1b[44m",
  BgMagenta = "\x1b[45m",
  BgCyan = "\x1b[46m",
  BgWhite = "\x1b[47m",
}

export class ConsoleLog implements Log {
  level = LogLevel.Info;

  debug(message: String, ...args: any[]): void {
    if (this.level <= LogLevel.Debug) console.log(`${CC.Dim}DEBUG${CC.Reset}`, new Date(), message, ...args);
  }
  info(message: String, ...args: any[]): void {
    if (this.level <= LogLevel.Info) console.log(`${CC.FgCyan}INFO ${CC.Reset}`, new Date(), message, ...args);
  }
  warn(message: String, ...args: any[]): void {
    if (this.level <= LogLevel.Warn) console.log(`${CC.FgYellow}WARN ${CC.Reset}`, new Date(), message, ...args);
  }
  error(message: String, ...args: any[]): void {
    if (this.level <= LogLevel.Error) console.log(`${CC.FgRed}ERROR${CC.Reset}`, new Date(), message, ...args);
  }
  fatal(message: String, ...args: any[]): void {
    if (this.level <= LogLevel.Fatal) console.log(`${CC.BgRed}FATAL${CC.Reset}`, new Date(), message, ...args);
  }
}

