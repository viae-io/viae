export interface Log {
  debug(message: String, ...args): void;
  info(message: String, ...args): void;
  warn(message: String, ...args): void;
  error(message: String,  ...args): void;
  fatal(message: String,  ...args): void;
}

const logLevel = {
  ["error"]: 1,
  ["warn"]: 2,
  ["info"]: 3,
  ["debug"]: 4,
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
  level = logLevel["info"]

  debug(message: String, ...args: any[]): void {
    if (this.level >= logLevel["debug"]) console.log(`${CC.Dim}DEBUG${CC.Reset}`, new Date(), message, args.length > 0 ? "\n" : "", ...args);
  }
  info(message: String, ...args: any[]): void {
    if (this.level >= logLevel["info"]) console.log(`${CC.FgCyan}INFO ${CC.Reset}`, new Date(), message, args.length > 0 ? "\n" : "", ...args);
  }
  warn(message: String, ...args: any[]): void {
    if (this.level >= logLevel["warn"]) console.log(`${CC.FgYellow}WARN ${CC.Reset}`, new Date(), message, args.length > 0 ? "\n" : "", ...args);
  }
  error(message: String, ...args: any[]): void {
    if (this.level >= logLevel["error"]) console.log(`${CC.FgRed}ERROR${CC.Reset}`, new Date(), message, args.length > 0 ? "\n" : "", ...args);
  }
}

