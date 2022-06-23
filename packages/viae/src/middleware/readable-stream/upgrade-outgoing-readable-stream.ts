import { Context } from '../../context';
import { Middleware } from "rowan";
import { ReadableStreamSender } from './readable-stream-sender';
import { isReadableStream } from './is-readable-stream';
import { SendOptions } from '../../_via';
export class UpgradeOutgoingReadableStream implements Middleware<Context> {
  meta: {
    type: "OutgoingReadableStream";
  };
  async process(ctx: Context, next: () => Promise<void>) {
    if (!ctx)
      return next();
    const head = ctx.out.head;
    const data = ctx.out.data;
    const encoding = head.encoding as any;

    let opts: SendOptions = encoding != null ? {encoding } : undefined;

    if (isReadableStream(data)) {
      console.log("upgrading outgoing stream");
      let readable = data;
      let sid = ctx.connection.createId();
      let router = new ReadableStreamSender(readable, function () { dispose(); }, opts);
      let dispose = ctx.connection.intercept(sid, [router]);
      head["readable"] = sid;
      delete ctx.out.data;
    }
    return next();
  }
}
