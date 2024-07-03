import { Middleware } from "rowan";
import { bytesToText } from '../util';
import { Context } from "../context";
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import { pack as msgpackEncode, unpack as msgpackDecode} from 'msgpackr';

/**
 * Adds a Lazy data decoder to the incoming message
 */
export default class BodyDecoder<Ctx extends Context = Context> implements Middleware<Context> {
  meta: {
    type: "BodyDecoder"
  }
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    if (ctx["__decoded"] === true || !ctx.in || !ctx.in.head || !ctx.in.raw) return next();

    Object.defineProperty(ctx.in, "data", {
      configurable: true,
      get: function () {
        delete ctx.in.data;
        switch (ctx.in.head.encoding) {
          case "msgpack":
            ctx.in.data = msgpackDecode(ctx.in.raw);
            ctx["__decoded"] = true;
            break;
          case "cbor":
            ctx.in.data = cborDecode(ctx.in.raw);
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