import { Middleware } from "rowan";
import { Codex } from '../util';
import { Context } from "../context";

/**
 * Encodes the outgoing message data
 */
export default class BodyEncoder implements Middleware<Context> {
  constructor(private _codex: Codex, private defaultEncoding = "msgpack") {
    if (_codex == null) {
      throw Error("body encoder must be initialized with a codex");
    }
  }
  meta: {
    type: "BodyEncoder"
  }
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    if (ctx["__encoded"] === true || !ctx.out || ctx.out.data === undefined || !ctx.out.head) return next();

    if(ctx.out.head.encoding == undefined){
      if(ctx.out.data instanceof Uint8Array) {
        ctx.out.raw = ctx.out.data;
        ctx.out.head.encoding = "none";
        ctx["__encoded"] = true;
      } else {
        ctx.out.head.encoding = this.defaultEncoding;
      }
    }

    let encoder = this._codex[ctx.out.head.encoding];
    
    if (encoder) {
      ctx.out.raw = encoder.encode(ctx.out.data);
      ctx["__encoded"] = true;
    }

    return next();
  }
}