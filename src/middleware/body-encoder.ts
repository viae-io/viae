import { Middleware } from "rowan";
import * as msgpack from 'msgpack-lite';
import { textToBytes } from '../util';
import { Context } from "../context";

/**
 * Encodes the outgoing message body
 */
export default class BodyEncoder<Ctx extends Context = Context> implements Middleware<Context> {
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    switch (ctx.out.head.encoding) {
      default:
      case "msgpack":
        ctx.out.head.encoding = "msgpack";
        ctx.out.body = msgpack.encode(ctx.out.body);
        break;
      case "json":
        ctx.out.body = textToBytes(JSON.stringify(ctx.out.body));
        break;
    }
    return next();
  }
}