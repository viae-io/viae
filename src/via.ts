import { Rowan, Middleware } from "rowan";
import { IFrame, IMessage } from './_message';
import IWire from "./_wire";

type ViaeMeta = {
  [index: string]: any;
};

class MsgPackDecoder<T = any, Meta = ViaeMeta> implements Middleware<IFrame, IMessage<T>, Meta> {
  meta?: Meta;
  process(ctx: IFrame, next: (ctx?: IMessage<T>) => Promise<void>): Promise<void> {
    let _ctx: IMessage<T> = ctx as any;

    if (ctx.encoding != "msgpack")
      throw Error("invalid encoding, expected \"msgpack\" got \"" + ctx.encoding + "\"");

    return next();
  }
}

export default class Via<T> extends Rowan<T> {

  constructor(wire: IWire) {
    super();

    wire.on("message", (message: ArrayBuffer) => {


      const _ = this.execute(ctx)
        .catch((err) => {
          console.log("unhandled processing error", err);
          wire.close();
        });
    });
  }
}