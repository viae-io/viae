export interface Logger {
  debug(message: String, ctx?: any): void;
  info(message: String, ctx?: any): void;
  warn(message: String, ctx?: any): void;
  error(message: String, ctx?: { err?: Error }): void;
  fatal(message: String, ctx?: { err?: Error }): void;
}

export class ConsoleLogger implements Logger {
  debug(message: String, ctx?: any): void {
    console.log("DEBUG", new Date(), message, ctx);
  }
  info(message: String, ctx?: any): void {
    console.log("INFO", new Date(), message, ctx);
  }
  warn(message: String, ctx?: any): void {
    console.log("WARN", new Date(), message, ctx);
  }
  error(message: String, ctx?: any): void {
    console.log("ERROR", new Date(), message, ctx);
  }
  fatal(message: String, ctx?: any): void {
    console.log("FATAL", new Date(), message, ctx);
  }
}