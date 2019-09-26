import { Rowan, After, AfterIf, Processor, Catch } from "rowan";
import { EventEmitter } from "events";
import { Wire, Status } from "@viae/core";
import { Message, isRequest } from './message';
import { Context, ContextConstructor, DefaultContext } from "./context";

import DataDecoder from "./middleware/data-decoder";
import DataEncoder from "./middleware/data-encoder";
import Interceptor from "./middleware/interceptor";
import Send from "./middleware/send";

import { FrameEncoder } from "@viae/pb";
import { Log, ConsoleLog } from "./log";
import { toUint8Array, shortId } from "./util";
import { UpgradeOutgoingObservable, UpgradeIncomingObservable } from "./middleware/observable";
import { IVia, SendOptions, CallOptions } from "./_via";
import { normalisePath } from "./util/normalise";


/**
 * Via
 * Wraps a wire connection and processes inbound and outbound messages
 */
export class Via<C extends Context = Context> extends Rowan<C> implements IVia<C> {
  private _ev = new EventEmitter();
  private _wire: Wire;
  private _uuid: () => string;
  private _log: Log;
  private _timeout: number;
  private _interceptor = new Interceptor();
  private _encoder = new FrameEncoder();
  private _before: Rowan<Context> = new Rowan<Context>();
  private CtxCtor: ContextConstructor;

  /* outgoing message pipeline */

  readonly out: Rowan<Context> = new Rowan<Context>();

  get wire() {
    return this._wire;
  }

  constructor(opts: { wire: Wire, Ctx?: ContextConstructor, uuid?: () => string, log?: Log, timeout?: number }, ) {
    super();

    const wire = this._wire = opts.wire;

    this.CtxCtor = (opts ? opts.Ctx : undefined) || DefaultContext;
    this._log = (opts ? opts.log : undefined) || new ConsoleLog();
    this._uuid = (opts ? opts.uuid : undefined) || shortId;
    this._timeout = (opts ? opts.timeout : undefined) || 10000;

    this
      /* execute the 'before' pipeline */
      .use(this._before)
      /* execute the 'outbound' pipeline after the main pipeline */
      .use(new After([
        this.out
          .use(new AfterIf(function (ctx) { return Promise.resolve(!!ctx.out); }, [
            new UpgradeOutgoingObservable(),
            new DataEncoder(),
            new Send(this._encoder)
          ]))
      ]))
      .use(new Catch(
        function (err, ctx) {
          ctx.err = err;
          ctx.out.head.status = Status.Error;
          ctx.out.data = err.message;          
          return Promise.resolve();
        }))
      /* add the lazy data decoder */
      .use(new DataDecoder())
      /* convert data to an observable */
      .use(new UpgradeIncomingObservable())
      /* intercept id-matching messages */
      .use(this._interceptor);
      /* ... then any more .use() middleware 

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

  private _onMessage(data: ArrayBuffer | ArrayBufferView) {
    const msg = this._encoder.decode(toUint8Array(data));
    const ctx = new this.CtxCtor({ connection: this as IVia<C>, in: msg, log: this._log });

    this._log.debug("Received", msg);

    this.process(ctx as C).catch(err => {
      this._log.error("Unhandled Error", err);
      this._ev.emit("error", err);
    });
  }

  /**
   * Fire and Forget - Add a message to the outgoing pipeline
   **/
  send(msg: Partial<Message>, opts?: SendOptions) {
    if (!msg.id) msg.id = shortId();
    if (opts && opts.encoding) {
      msg.head = msg.head || {};
      msg.head.encoding = opts.encoding;
    }

    return this.out.process(new this.CtxCtor({ connection: this as unknown as IVia<C>, out: msg as Message, log: this._log })).catch((err) => {
      this._ev.emit("error", err);
    });
  }

  /**
   * Send a request message, add an one-off interceptor for the response. Returns promise to first response. 
   * @param msg 
   * @param opts 
   */
  async request(
    method: string,
    path: string,
    data?: any,
    opts?: SendOptions) {

    path = normalisePath(path);

    let msg: Partial<Message> = {
      id: (opts && opts.id) ? opts.id : shortId(),
      head: {
        method,
        path
      }
    };

    if (data) {
      msg.data = data;
    }

    let reject, resolve, promise = new Promise<Message>((r, x) => { resolve = r; reject = x; });
    let clock;

    let dispose = this._interceptor.intercept({
      id: msg.id,
      handlers: [function (ctx, _) {
        resolve(ctx.in);
        return Promise.resolve();
      }]
    });

    clock = setTimeout(() => { reject("Request Timeout"); }, (opts ? opts.timeout : undefined) || this._timeout);

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
   * simplified request/response  - this will deserialise the response data and return it if successful. 
   * throws an error if the result status is not OK. 
   **/
  async call<E = any>(method: string, path: string, data?: any, opts?: CallOptions<E>): Promise<E> {
    let result = await this.request(method, path, data, opts);
    switch (Number(result.head.status)) {
      case Status.NotFound:
        throw Error(`${method} "${path}" not found`);
      case Status.Unauthorized:
        throw Error(`${method} "${path}" not authorised`);
      case Status.Forbidden:
        throw Error(`${method} "${path}" forbidden`);
      case Status.BadRequest:
        throw Error(`${method} "${path}" bad request`);
      case Status.Error:
        let msg = `${method} "${path}" error`;
        let resultData = result.data;
        if (resultData != undefined && typeof resultData === "string") {
          msg += ": " + resultData;
        }
        throw Error(msg);
      case Status.OK:
      case Status.OkayPartial:
        let validate = (opts && typeof opts.validate == "function") ? opts.validate : () => true;
        validate(result.data);
        return result.data;
      default:
        throw Error(`${method} "${path}" unknown status code: ${result.head.status}`)
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

  off(event: "close", cb: () => void)
  off(event: "open", cb: () => void)
  off(event: "error", cb: (err: Error, ctx: C) => void)
  off(event: string, cb: (...args: any[]) => void) {
    this._ev.off(event, cb);
  }

  static Log: Log = new ConsoleLog();
}

