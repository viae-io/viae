import { Middleware } from "rowan";
import { Codex } from '../util';
import { Context } from "../context";


/**
 * Adds a Lazy data decoder to the incoming message
 */
export default class BodyDecoder implements Middleware<Context> {
  constructor(private _codex: Codex) {
    if(_codex == null){
      throw Error("body decoder must be initialized with a codex");
    }
  }

  meta: {
    type: "BodyDecoder"
  }
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {

    if (ctx["__decoded"] === true || !ctx.in || !ctx.in.head || !ctx.in.raw) return next();
    const codex = this._codex;


    Object.defineProperty(ctx.in, "data", {
      configurable: true,
      get: function () {
        delete ctx.in.data;
        let encoder = codex[ctx.in.head.encoding];

        if(encoder){
          ctx.in.data = encoder.decode(ctx.in.raw);
          ctx["__decoded"] = true;
        }
        
        return ctx.in.data;
      }
    });

    return next();
  }
}