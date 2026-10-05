import { Rowan, type Middleware, type Processor, type Next } from "rowan";
import type { Context } from "./context.js";
import type { Message } from "./message.js";

interface InterceptEntry {
  dispose(): void;
  middleware: Middleware<Context>[];
}

/**
 * Intercepts messages by id. Used for request/response correlation
 * and multiplexed stream control frames.
 */
export class Interceptor implements Middleware<Context> {
  private _entries = new Map<string, InterceptEntry>();

  intercept(opts: {
    id: string;
    handlers: Processor<Context>[];
  }): () => void {
    if (!opts.id) throw new Error("id is required");
    if (!opts.handlers.length) throw new Error("handlers required");
    if (this._entries.has(opts.id)) throw new Error(`id already in use: ${opts.id}`);

    const middleware = opts.handlers.map(h => Rowan.convertToMiddleware(h));

    const entry = { middleware } as InterceptEntry;
    entry.dispose = () => {
      if (this._entries.get(opts.id) === entry) this._entries.delete(opts.id);
    };

    this._entries.set(opts.id, entry);
    return entry.dispose;
  }

  /** 
   * Simple callback-style intercept. Returns a dispose function. 
   * Does NOT call next – the message is fully consumed.
   */
  interceptFn(id: string, fn: (msg: Message) => void | Promise<void>): () => void {
    return this.intercept({
      id,
      handlers: [(ctx: Context) => {
        const result = fn(ctx.in);
        delete ctx.out;
        return result ?? Promise.resolve();
      }]
    });
  }

  process(ctx: Context, next: Next): Promise<void> {
    const id = ctx.in.id;
    const entry = this._entries.get(id);

    if (entry) {
      return Rowan.process(entry.middleware, ctx, next);
    }

    return next();
  }

  dispose() {
    for (const [, entry] of this._entries) {
      entry.dispose();
    }
    this._entries.clear();
  }
}
