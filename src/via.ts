import { Rowan, Middleware, IRowan, After, If, Catch, Processor } from "rowan";
import { EventEmitter } from "events";

import { Wire } from "./wire";

import { Message } from './message';
import { Context, ContextConstructor, DefaultContext } from "./context";
import BodyDecoder from "./middleware/body-decoder";
import BodyEncoder from "./middleware/body-encoder";
import Send from "./middleware/send";


/**
 * Via
 * Wraps a wire connection and processes inbound and outbound messages
 */
export default class Via<Ctx extends Context = Context> extends Rowan<Ctx> {
  private _ev = new EventEmitter();

  /* outgoing message pipeline */
  readonly out: Rowan<Context> = new Rowan<Context>();

  constructor(public readonly wire: Wire, private _Ctx: ContextConstructor = DefaultContext) {
    super();

    const incoming = this;
    const outgoing = this.out;

    incoming.use(new Catch((err) => { this._ev.emit("error", err); return wire.close(); }));
    incoming.use(new After([outgoing]));

    outgoing.use(new After([
      new BodyEncoder(),
      new Send()
    ]));

    wire.on("message", (data: ArrayBuffer) => {
      const ctx = new this._Ctx({ connection: this, in: data });
      this.process(ctx as Ctx).catch(e => this._ev.emit("fatal", e));
    });
  }

  on(event: "error", cb: (err: Error) => void)
  on(event: string, cb: (...args: any[]) => void) {
    this._ev.on(event, cb);
  }
}