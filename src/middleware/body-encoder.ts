import { Middleware } from "rowan";
import * as msgpack from 'msgpack-lite';
import { textToBytes } from '../util';
import { Context } from "../context";

/**
 * Encodes the outgoing message body
 */
export default class BodyEncoder<Ctx extends Context = Context> implements Middleware<Context> {
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    if (ctx["encoded"] === true || !ctx.out || !ctx.out.body || !ctx.out.head || ctx.encoded) return next();

    switch (ctx.out.head.encoding) {
      case "none":
        break;
      case "json":
        ctx.out.body = textToBytes(JSON.stringify(ctx.out.body));
        break;
      case "msgpack":
      default:      
        ctx.out.head.encoding = "msgpack";
        ctx.out.body = msgpack.encode(ctx.out.body);
        break;
    }

    ctx["encoded"] = true;

    return next();
  }
}