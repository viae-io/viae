import { Middleware } from "rowan";
import { Context } from "../context";
import { encode } from '../message';

/**
 * Sends the outgoing message and terminates
 */
export default class Send<Ctx extends Context = Context> implements Middleware<Context> {
  async process(ctx: Context, next: (ctx?: Context) => Promise<void>): Promise<void> {
    let out = ctx.out;

    if (!out) return;

    let raw = encode(out);

    ctx.connection.wire.send(raw);
  }
}