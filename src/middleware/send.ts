import { Middleware } from "rowan";
import { Context } from "../context";
import { encode } from '../message';

/**
 * Send the outgoing message terminate
 */
export default class Send<Ctx extends Context = Context> implements Middleware<Context> {
  process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    let out = ctx.out;

    if (!out) return;

    if (out.body instanceof Uint8Array == false){
      throw Error("Outbound message body is not an Uint8Array instance");
    }     

    let raw = encode(out);

    ctx.connection.wire.send(raw);
  }
}