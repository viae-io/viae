

import { Middleware, Next, Processor } from 'rowan';
import { Context } from '../context';
import { ViaeError } from '../error';
import { MessageHeader } from '@viae/core';
import { isReadableStream } from './readable-stream';
import { Router } from './router';

export interface HandlerOptions<D, C extends Context = Context> {
  data: D,
  head: MessageHeader,
  raw: Uint8Array,
  path: string,
  ctx: C,
  params: Record<string, string>
  next?: Next
}
export type ApiAcceptOptions = {
  type: "object" | "stream"
}

export type ApiRouteOptions<R, A extends "stream" | "object", C extends Context = Context> = {
  path: string,
  end?: true,
  next?: true,
  accept?: A,
  validate?(value: any): asserts value is R,
  handler: (opt: HandlerOptions<A extends "stream" ? ReadableStream<R> : R, C>) => any
}

export type ApiFn = <R, A extends "stream" | "object" >(opts: ApiRouteOptions<R, A>) => void

export class Api<C extends Context = Context> extends Router {

  constructor(root?: string) {
    super({ root: root || "/" });

    const methodFn = (method: string) => <R, A extends "stream" | "object">(opts: ApiRouteOptions<R, A>) => {
      const { path, handler } = opts;

      let isNext = (opts.next === true) ? true : false;
      let end = opts.end != undefined ? true : false;

      super.route({
        path,
        method,
        end,
        process: [
          async function (ctx, next) {
            const log = ctx.connection.log;

            let args: any = {
              data: ctx.in.data,
              head: ctx.in.head,
              raw: ctx.in.raw,
              path: ctx.in.head.matchedPath,
              ctx: ctx as C,
              params: ctx.params
            };

            log.debug({
              method: method,
              end,
              path: args.path,
              params: args.params,
              data: args.data,
            }, "processing api route");

            if (isNext) {
              args.next = next
            }

            try {
              if (opts.accept) {
                if (opts.accept == "stream") {
                  if (!isReadableStream(args.data)) {
                    log.debug({
                      method: method,
                      path: args.path,
                    }, "failed accept check");
                    throw new ViaeError(400, "invalid argument. expected stream");
                  }
                }
                if (opts.accept == "object") {
                  if (args.data === undefined || isReadableStream(args.data)) {
                    log.debug({
                      method: method,
                      path: args.path,
                    }, "failed accept check");
                    throw new ViaeError(400, "invalid argument. expected object");
                  }
                }
              }

              if (opts.validate) {
                if (!isReadableStream(args.data)) {
                  try {
                    opts.validate(args.data);
                  } catch (err) {
                    log.debug({
                      method: method,
                      end,
                      path: args.path,
                      params: args.params,
                      data: args.data,
                      err
                    }, "failed validation");
                    throw new ViaeError(400, err!.message ? err!.message : "unknown validation error");
                  }
                } else {
                  args.data = args.data.pipeThrough(new TransformStream({
                    transform(chunk, controller) {
                      try { opts.validate(chunk) }
                      catch (err) {
                        log.debug({
                          method: method,
                          end,
                          path: args.path,
                          params: args.params,
                          data: args.data,
                          err
                        }, "failed validation");
                        throw new ViaeError(400, err!.message ? err!.message : "unknown validation error");
                      }
                      controller.enqueue(chunk);
                    }
                  }), {})
                }
              }

              const result = await handler(args);

              log.debug({ result }, "handler returned")

              if (result !== undefined) {
                ctx.out.data = result;
              }

              if (isNext == false) {
                ctx.out.head.status = 200;
              }

            } catch (err) {
              if (typeof err == "number") {
                ctx.out.head.status = err;
              }
              else if (err instanceof ViaeError) {
                ctx.out.head.status = err.status;
                ctx.out.data = err.message;
              }
              else {
                throw err;
              }
            }
          }
        ]
      })
    }

    this.all = methodFn(null);
    this.get = methodFn("GET");
    this.post = methodFn("POST");
    this.put = methodFn("PUT");
    this.delete = methodFn("DELETE");
    this.subscribe = methodFn("SUBSCRIBE");
  }

  all: ApiFn;
  get: ApiFn;
  post: ApiFn;
  put: ApiFn;
  delete: ApiFn;
  subscribe: ApiFn;

  use(processor: Processor<C>)
  use(path: string, api: Middleware<C>)
  use(arg1: string | Processor<C>, arg2?: Middleware<C>) {
    if (typeof arg1 == "string") {
      let path = arg1;
      let api = arg2;
      super.route({ path, method: null, process: [api] })
    } else {
      super.use(arg1);
    }
  }
}