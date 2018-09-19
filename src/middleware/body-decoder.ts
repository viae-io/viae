import { Middleware } from "rowan";
import * as msgpack from 'msgpack-lite';
import { bytesToText } from '../util';
import { Context } from "../context";

/**
 * Decodes the incoming message body
 */
export default class BodyDecoder<Ctx extends Context = Context> implements Middleware<Context> {
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    if (ctx["decoded"] === true || !ctx.in || !ctx.in.head || !ctx.in.data) return next();

    switch (ctx.in.head.encoding) {
      case "msgpack":
        ctx.in.data = msgpack.decode(ctx.in.data);
        break;
      case "json":
        ctx.in.data = JSON.parse(bytesToText(ctx.in.data));
        break;
    }

    ctx["decoded"] = true;
    
    return next();
  }
}