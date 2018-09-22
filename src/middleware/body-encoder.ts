import { Middleware } from "rowan";
import * as msgpack from 'msgpack-lite';
import { textToBytes } from '../util';
import { Context } from "../context";

/**
 * Encodes the outgoing message body
 */
export default class BodyEncoder<Ctx extends Context = Context> implements Middleware<Context> {
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    if (ctx["__encoded"] === true || !ctx.out || !ctx.out.data || !ctx.out.head) return next();

    switch (ctx.out.head.encoding) {
      case undefined:
      case "msgpack":
        ctx.out.head.encoding = "msgpack";
        ctx.out.data = msgpack.encode(ctx.out.data);
        ctx["__encoded"] = true;
        break;
      case "json":
        ctx.out.head.encoding = "json";
        ctx.out.data = textToBytes(JSON.stringify(ctx.out.data));
        ctx["__encoded"] = true;
        break;
      case "none":
        ctx["__encoded"] = true;
        break;
      default:
    }
    return next();
  }
}