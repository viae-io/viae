import { Rowan, Middleware, IRowan, After, AfterIf, If, Catch, Processor } from "rowan";
import { EventEmitter } from "events";

import { Wire } from "./wire";

import { Message, isRequest } from './message';
import { Context, ContextConstructor, DefaultContext, } from "./context";
import BodyDecoder from "./middleware/body-decoder";
import BodyEncoder from "./middleware/body-encoder";
import Interceptor from "./middleware/interceptor";
import Send from "./middleware/send";

import { v4 as uuid } from 'uuid';
import { UpgradeOutgoingIterable, UpgradeIncomingIterable } from "./middleware/iterable";
import { MessageSerialiser } from "./message-encoder";
import { Logger, ConsoleLogger } from "./log";
import { toUint8Array } from "./util";

/**
 * Via
 * Wraps a wire connection and processes inbound and outbound messages
 */
export default class Via<Ctx extends Context = Context> extends Rowan<Ctx> {
  private _ev = new EventEmitter();
  private _log: Logger;
  private _interceptor = new Interceptor();
  private _encoder = new MessageSerialiser();
  private _before: Rowan<Context> = new Rowan<Context>();
  private Ctx: ContextConstructor;

  /* outgoing message pipeline */

  readonly out: Rowan<Context> = new Rowan<Context>();

  constructor(public readonly wire: Wire, opts?: { Ctx?: ContextConstructor, uuid?: () => string, log?: Logger }, ) {
    super();

    this.Ctx = (opts ? opts.Ctx : undefined) || DefaultContext;
    this._log = (opts ? opts.log : undefined) || new ConsoleLogger();

    this
      .use(this._before)
      .use(new After([
        this.out
          .use(new AfterIf((ctx) => !!ctx.out, [
            new UpgradeOutgoingIterable(),
            new BodyEncoder(),
            new Send(this._encoder)
          ]))
      ]))
      .use(new Catch(async (err: Error, ctx: Ctx) => { this._ev.emit("error", err, ctx); }))
      .use(new BodyDecoder())
      .use(new UpgradeIncomingIterable())
      .use(this._interceptor);

    /** Hook onto the wire events*/
    wire.on("message", (data: ArrayBuffer | ArrayBufferView) => {
      const msg = this._encoder.decode(toUint8Array(data));
      const ctx = new this.Ctx({ connection: this, in: msg });
      this.process(ctx as Ctx).catch(e => this._ev.emit("error", e));
    });
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

  /**
   * Add a message to the outgoing pipeline
   **/
  private async _send(msg: Partial<Message<any>>, opts?: ViaSendOptions) {
    if (!msg.id) msg.id = uuid();
    if (opts && opts.encoding) {
      msg.head = msg.head || {};
      msg.head.encoding = opts.encoding;
    }
    await this.out.process(new this.Ctx({ connection: this, out: msg as Message<any> }));
  }

  /**
   * Send a request message, add an one-off interceptor for the response. Returns promise to first response. 
   * @param msg 
   * @param opts 
   */
  async request(msg: Partial<Message<any>>, opts?: ViaSendOptions) {
    if (!msg.id) msg.id = uuid().replace('-', '');

    if (!isRequest(msg)) {
      throw Error("Message is not a Request");
    }

    let reject, resolve, promise = new Promise<Message>((r, x) => { resolve = r; reject = x; });
    let clock;

    let dispose = this._interceptor.intercept({
      id: msg.id,
      handlers: [async (ctx, next) => {
        resolve(ctx.in);
      }]
    });

    clock = setTimeout(() => { reject("Request Timeout"); }, (opts ? opts.timeout : undefined) || 10000);

    try {
      await this._send(msg, opts);
      return await promise;
    }
    catch (err) {
      throw err;
    }
    finally {
      clearTimeout(clock);
      dispose();
    }
  }

  /**
   * intercept an id-specific message 
   * @param id message id to intercept
   * @param handlers processors to call on interception
   */
  intercept(id: string, handlers: Processor<Ctx>[]) {
    return this._interceptor.intercept({ id: id, handlers: handlers });
  }

  /**
   * processors to use before any  in-built (inbound)processing
   * @param processor 
   */
  before(processor: Processor<Ctx>) {
    this._before.use(processor);
    return this;
  }

  on(event: "close", cb: () => void)
  on(event: "open", cb: () => void)
  on(event: "error", cb: (err: Error, ctx: Ctx) => void)
  on(event: string, cb: (...args: any[]) => void) {
    this._ev.on(event, cb);
  }
}

export type ViaSendOptions = {
  encoding?: "none" | "msgpack" | "json",
  timeout?: number
};