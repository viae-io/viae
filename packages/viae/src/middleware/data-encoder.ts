import { Middleware } from "rowan";
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import { pack as msgpackEncode, unpack as msgpackDecode } from 'msgpackr';
import { textToBytes } from '../util';
import { Context } from "../context";

/**
 * Encodes the outgoing message data
 */
export default class BodyEncoder<Ctx extends Context = Context> implements Middleware<Context> {
  meta: {
    type: "BodyEncoder"
  }
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    if (ctx["__encoded"] === true || !ctx.out || ctx.out.data === undefined || !ctx.out.head) return next();

    switch (ctx.out.head.encoding) {
      default:
      case undefined:
        if (ctx.out.data instanceof Uint8Array) {
          ctx.out.raw = ctx.out.data;
          ctx.out.head.encoding = "none";
          ctx["__encoded"] = true;
          break;
        }
      //roll over and default to: 
      case "msgpack":
        ctx.out.head.encoding = "msgpack";
        ctx.out.raw = msgpackEncode(ctx.out.data);
        ctx["__encoded"] = true;
        break; 
      case "cbor":
        ctx.out.head.encoding = "cbor";
        ctx.out.raw = cborEncode(ctx.out.data);
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

    }
    return next();
  }
}