import { Middleware } from "rowan";
import { Context } from "../context";
import { FrameEncoder } from "@viae/pb";

/**
 * Sends the outgoing message and terminates
 */
export default class Send<Ctx extends Context = Context> implements Middleware<Context> {
  constructor(private _encoder: FrameEncoder) { }
  async process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    let out = ctx.out;
    if (out) {          
      let raw = this._encoder.encode(out);
      ctx.connection.log.debug("Sending", out);
      ctx.connection.wire.send(raw);
    }    
  }
}