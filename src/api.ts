import { type Middleware, type Next, type Processor } from "rowan";
import type { Context } from "./context.js";
import { ViaeError } from "./error.js";
import { Router } from "./router.js";

export interface HandlerOptions<D, C extends Context = Context> {
  data: D;
  head: Record<string, unknown>;
  raw: Uint8Array | undefined;
  path: string;
  ctx: C;
  params: Record<string, string>;
  next?: Next;
}

/**
 * Api route options.
 * 
 * accept: 
 *   "stream"  - data is a ReadableStream<R>
 *   "object"  - data is R (default)
 * 
 * validate: type guard function.  
 *   For "object": (value: unknown) => value is R
 *   For "stream": applied per-chunk via TransformStream
 */
export type ApiRouteOptions<R, A extends "stream" | "object" = "object", C extends Context = Context> = {
  path: string;
  end?: boolean;
  next?: boolean;
  accept?: A;
  validate?: (value: unknown) => value is R;
  handler: (opt: HandlerOptions<A extends "stream" ? ReadableStream<R> : R, C>) => unknown | Promise<unknown>;
}

export type ApiFn<C extends Context = Context> = <R, A extends "stream" | "object" = "object">(opts: ApiRouteOptions<R, A, C>) => void;

function isReadableStream(obj: unknown): obj is ReadableStream {
  if (obj == null) return false;
  if (obj instanceof ReadableStream) return true;
  if (typeof obj === "object" && "getReader" in obj) return true;
  return false;
}

export class Api<C extends Context = Context> implements Middleware<Context> {
  private _router: Router;

  all: ApiFn<C>;
  get: ApiFn<C>;
  post: ApiFn<C>;
  put: ApiFn<C>;
  delete: ApiFn<C>;
  subscribe: ApiFn<C>;

  constructor(protected root?: string) {
    this._router = new Router({ root });

    const methodFn = (method: string | null): ApiFn<C> => <R, A extends "stream" | "object" = "object">(opts: ApiRouteOptions<R, A, C>) => {
      const { path, handler } = opts;
      const isNext = opts.next !== undefined ? true : false;
      const end = opts.end !== undefined ? opts.end : true;

      this._router.route({
        path,
        method,
        end,
        process: [
          async function (ctx: Context, next?: Next) {
            const args: HandlerOptions<unknown> = {
              data: ctx.in.data,
              head: ctx.in.head,
              raw: ctx.in.raw,
              path: (ctx.in.head.matchedPath as string) || "",
              ctx,
              params: ctx.params,
            };

            if (isNext) {
              args.next = next;
            }

            try {
              /* accept guard — only validate when data is actually provided */
              if (args.data !== undefined) {
                if (opts.accept === "stream") {
                  if (!isReadableStream(args.data)) {
                    throw new ViaeError(400, "expected stream");
                  }
                } else if (opts.accept === "object") {
                  if (isReadableStream(args.data)) {
                    throw new ViaeError(400, "expected object");
                  }
                }
              }

              /* validation - type guard */
              if (opts.validate) {
                if (isReadableStream(args.data)) {
                  /* pipe through a validating transform for streams */
                  const validate = opts.validate;
                  args.data = (args.data as ReadableStream).pipeThrough(new TransformStream({
                    transform(chunk, controller) {
                      if (!validate(chunk)) {
                        throw new ViaeError(400, "validation failed");
                      }
                      controller.enqueue(chunk);
                    }
                  }));
                } else {
                  if (!opts.validate(args.data)) {
                    throw new ViaeError(400, "validation failed");
                  }
                }
              }

              const result = await handler(args as HandlerOptions<never, C>);

              if (result !== undefined && ctx.out) {
                ctx.out.data = result;
              }

              if (!isNext && ctx.out) {
                ctx.out.head.status = 200;
              }
            } catch (err) {
              if (typeof err === "number" && ctx.out) {
                ctx.out.head.status = err;
              } else if (err instanceof ViaeError && ctx.out) {
                ctx.out.head.status = err.status;
                ctx.out.data = err.message;
              } else {
                throw err;
              }
            }
          }
        ]
      });
    };

    this.all = methodFn(null);
    this.get = methodFn("GET");
    this.post = methodFn("POST");
    this.put = methodFn("PUT");
    this.delete = methodFn("DELETE");
    this.subscribe = methodFn("SUBSCRIBE");
  }

  use(path: string, handler: Middleware<Context> | ((ctx: C, next: Next) => Promise<void>)): void {
    const p = path === "*" ? "/" : path;
    this._router.route({ path: p, method: null, end: false, process: [handler as Processor<Context>] });
  }

  process(ctx: Context, next: Next): Promise<void> {
    return this._router.process(ctx, next);
  }
}
