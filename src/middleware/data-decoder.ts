import { Middleware } from "rowan";
import * as msgpack from 'msgpack-lite';
import { bytesToText } from '../util';
import { Context } from "../context";
import { runInThisContext } from "vm";

/**
 * Adds a Lazy data decoder to the incoming message
 */
export default class BodyDecoder<Ctx extends Context = Context> implements Middleware<Context> {
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    if (ctx["__decoded"] === true || !ctx.in || !ctx.in.head || !ctx.in.raw) return next();

    Object.defineProperty(ctx.in, "data", {
      configurable: true,
      get: function () {     
        delete ctx.in.data;
        switch (ctx.in.head.encoding) {
          case "msgpack":
            ctx.in.data = msgpack.decode(ctx.in.raw);
            ctx["__decoded"] = true;
            break;
          case "json":
            ctx.in.data = JSON.parse(bytesToText(ctx.in.raw));
            ctx["__decoded"] = true;
            break;
          case "none":
            ctx.in.data = ctx.in.raw;
            ctx["__decoded"] = true;
            break;
          case undefined:
        }
        return ctx.in.data;
      }
    });

    return next();
  }
}