import { Rowan, After, AfterIf, Processor } from "rowan";
import { EventEmitter } from "events";
import { Wire } from "./wire";
import { Message, isRequest } from './message';
import { Context, ContextConstructor, DefaultContext } from "./context";

import DataDecoder from "./middleware/data-decoder";
import DataEncoder from "./middleware/data-encoder";
import Interceptor from "./middleware/interceptor";
import Send from "./middleware/send";

import { UpgradeOutgoingIterable, UpgradeIncomingIterable } from "./middleware/iterable";
import { MessageSerialiser } from "./message-encoder";
import { Log, ConsoleLog } from "./log";
import { toUint8Array, basicId } from "./util";
import { UpgradeOutgoingObservable, UpgradeIncomingObservable } from "./middleware/observable";
import { IVia, SendOptions } from "./_via";

/**
 * Via
 * Wraps a wire connection and processes inbound and outbound messages
 */
export class Via<C extends Context = Context> extends Rowan<C> implements IVia<C> {
  private _ev = new EventEmitter();
  private _wire: Wire;
  private _uuid: () => string;
  private _log: Log;
  private _interceptor = new Interceptor();
  private _encoder = new MessageSerialiser();
  private _before: Rowan<Context> = new Rowan<Context>();
  private CtxCtor: ContextConstructor;

  /* outgoing message pipeline */

  readonly out: Rowan<Context> = new Rowan<Context>();
  
  get wire(){
    return this._wire;
  }

  constructor(opts: { wire: Wire, Ctx?: ContextConstructor, uuid?: () => string, log?: Log }, ) {
    super();

    const wire = this._wire = opts.wire;

    this.CtxCtor = (opts ? opts.Ctx : undefined) || DefaultContext;

    this._log = (opts ? opts.log : undefined) || new ConsoleLog();
    this._uuid = (opts ? opts.uuid : undefined) || basicId;

    this
      /* execute the 'before' pipeline */
      .use(this._before)
      /* execute the 'outbound' pipeline after the main pipeline */
      .use(new After([
        this.out
          .use(new AfterIf((ctx) => !!ctx.out, [
            new UpgradeOutgoingIterable(),
            new UpgradeOutgoingObservable(),
            new DataEncoder(),
            new Send(this._encoder)
          ]))
      ]))
      /* add the lazy data decoder */
      .use(new DataDecoder())
      /* convert data to an async iterable */
      .use(new UpgradeIncomingIterable())
      /* convert data to an observable */
      .use(new UpgradeIncomingObservable())
      /* intercept id-matching messages */
      .use(this._interceptor);

    /** Hook onto the wire events*/
    wire.on("message", (data: ArrayBuffer | ArrayBufferView) => {
      this._onMessage(data);
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

  get log() {
    return this._log;
  }

  private async _onMessage(data: ArrayBuffer | ArrayBufferView) {
    const msg = this._encoder.decode(toUint8Array(data));
    const ctx = new this.CtxCtor({ connection:  this as IVia<C>, in: msg, log: this._log });

    this._log.debug("Received", msg);

    try {
      await this.process(ctx as C);
    } catch (err) {
      this._ev.emit("error", err);
    }
  }

  /**
   * Fire and Forget - Add a message to the outgoing pipeline
   **/
  async send(msg: Partial<Message>, opts?: SendOptions) {
    if (!msg.id) msg.id = basicId();
    if (opts && opts.encoding) {
      msg.head = msg.head || {};
      msg.head.encoding = opts.encoding;
    }

    try {
      await this.out.process(new this.CtxCtor({ connection: this as IVia<C>, out: msg as Message, log: this._log }));
    } catch (err) {
      this._ev.emit("error", err);
    }
  }

  /**
   * Send a request message, add an one-off interceptor for the response. Returns promise to first response. 
   * @param msg 
   * @param opts 
   */
  async request(msg: Partial<Message>, opts?: SendOptions) {
    if (!msg.id) msg.id = basicId();

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
      await this.send(msg, opts);
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
  intercept(id: string, handlers: Processor<C>[]) {
    return this._interceptor.intercept({ id: id, handlers: handlers });
  }

  /**
   * processors to use before any  in-built (inbound)processing
   * @param processor 
   */
  before(processor: Processor<C>) {
    this._before.use(processor);
    return this;
  }

  createId(): string {
    return this._uuid();
  }

  on(event: "close", cb: () => void)
  on(event: "open", cb: () => void)
  on(event: "error", cb: (err: Error, ctx: C) => void)
  on(event: string, cb: (...args: any[]) => void) {
    this._ev.on(event, cb);
  }

  static Log: Log = new ConsoleLog();
}

