import { Middleware } from "rowan";
import * as msgpack from 'msgpack-lite';
import { bytesToText } from '../util';
import { Context } from "../context";

/**
 * Decodes the incoming message body
 */
export default class BodyDecoder<Ctx extends Context = Context> implements Middleware<Context> {
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    switch (ctx.in.head.encoding) {
      case "msgpack":
        ctx.in.body = msgpack.decode(ctx.in.body);
        break;
      case "json":
        ctx.in.body = JSON.parse(bytesToText(ctx.in.body));
        break;
    }
    return next();
  }
}