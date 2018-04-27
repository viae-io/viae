import { Rowan, Middleware, IRowan, After, If, Catch, Processor, HasError } from "rowan";
import { EventEmitter } from "events";

import { Wire } from "./wire";

import { Message, decode } from './message';
import { Context, ContextConstructor, DefaultContext, ErredContext, Response, Request } from "./context";
import BodyDecoder from "./middleware/body-decoder";
import BodyEncoder from "./middleware/body-encoder";
import Interceptor from "./middleware/interceptor";
import Send from "./middleware/send";
import { bytesToHex, shortId } from "./util";

/**
 * Via
 * Wraps a wire connection and processes inbound and outbound messages
 */
export default class Via<Ctx extends Context = Context> extends Rowan<Ctx> {
  private _ev = new EventEmitter();
  private _interceptor = new Interceptor();

  /* outgoing message pipeline */
  readonly out: Rowan<Context> = new Rowan<Context>();

  constructor(public readonly wire: Wire, private _Ctx: ContextConstructor = DefaultContext) {
    super();

    const incoming = this;
    const outgoing = this.out;

    /** Configure Outgoing Pipeline */
    outgoing.use(new After([
      /* Serialise ctx.out.body to Binary */
      new BodyEncoder(),
      /* Send ctx.out*/
      new Send()
    ]));

    /** Add the Outgoing Pipeline (Response) */
    incoming.use(new After([new If((ctx) => ctx.out != undefined, [outgoing])]));

    /** Catch Unhandled Errors during the Incoming Pipeline */
    incoming.use(new Catch(async (ctx: Ctx & HasError) => { this._ev.emit("error", ctx); }));

    /** Decode Body */
    incoming.use(new BodyDecoder());

    /** Intercept */
    incoming.use(this._interceptor = new Interceptor());

    /** Extra Middleware Executes Here */

    /** Hook onto the wire */
    wire.on("message", (data: ArrayBuffer) => {
      const msg = decode(data);
      const ctx = new this._Ctx({ connection: this, in: msg);
      this.process(ctx as Ctx).catch(e => this._ev.emit("fatal", e));
    });

    /** Hook into wire */
    wire.on("open", () => {
      this._ev.emit("open");
    });
    wire.on("close", () => {
      this._interceptor.dispose();
      this._ev.emit("close");
    });
    wire.on("error", (err) => {
      this._ev.emit("error");
    });
  }

  async send(msg: Message<any>, opts?: ViaSendOptions) {   
    if (!msg.head) msg.head = {};
    if (!msg.head.id) msg.head.id = bytesToHex(shortId());

    await this.out.process(new this._Ctx({ connection: this, out: msg }));
  }

  on(event: "close", cb: () => void)
  on(event: "open", cb: () => void)
  on(event: "error", cb: (ctx: Ctx & HasError) => void)
  on(event: string, cb: (...args: any[]) => void) {
    this._ev.on(event, cb);
  }
}

export type ViaSendOptions = {
  encoding?: "none" | "msgpack" | "json"
};