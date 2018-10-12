export interface ILogger {
  debug(message: String, ctx?: any): void;
  info(message: String, ctx?: any): void;
  warn(message: String, ctx?: any): void;
  error(message: String, ctx?: { err: Error, [k: string]: any }): void;
  fatal(message: String, ctx?: { err: Error, [k: string]: any }): void;
}

export function Log() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // keep a reference to the original function
    const originalValue = descriptor.value;

    // Replace the original function with a wrapper
    descriptor.value = function (...args: any[]) {
      console.log(`=> ${propertyKey}(${args.join(", ")})`);

      // Call the original function
      var result = originalValue.apply(this, args);

      console.log(`<= ${result}`);
      return result;
    };
  };
}

export class ConsoleLogger implements ILogger {
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

