import { Middleware } from "rowan";
import * as msgpack from 'msgpack-lite';
import { textToBytes } from '../util';
import { Context } from "../context";

/**
 * Encodes the outgoing message data
 */
export default class BodyEncoder<Ctx extends Context = Context> implements Middleware<Context> {
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    if (ctx["__encoded"] === true || !ctx.out || !ctx.out.data || !ctx.out.head) return next();

    switch (ctx.out.head.encoding) {
      case undefined:
        if (ctx.out.data instanceof Uint8Array) {
          ctx.out.raw = ctx.out.data;
          ctx.out.head.encoding = "none";
          ctx["__encoded"] = true;
          break;
        }
      case "msgpack":
        ctx.out.head.encoding = "msgpack";
        ctx.out.raw = msgpack.encode(ctx.out.data);
        ctx["__encoded"] = true;
        break;
      case "json":
        ctx.out.head.encoding = "json";
        ctx.out.raw = textToBytes(JSON.stringify(ctx.out.data));
        ctx["__encoded"] = true;
        break;
      case "none":
        ctx.out.raw = ctx.out.data;
        ctx["__encoded"] = true;
        break;
      default:
    }
    return next();
  }
}