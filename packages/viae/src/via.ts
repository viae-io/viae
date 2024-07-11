import { Rowan, After, AfterIf, Processor, Catch, Meta } from "rowan";
import { EventEmitter } from "events";
import { Wire, Status, WireState } from "@viae/core";
import { Message, Response, isRequest } from './message';
import { Context, ContextConstructor, DefaultContext } from "./context";

import DataDecoder from "./middleware/data-decoder";
import DataEncoder from "./middleware/data-encoder";
import Interceptor from "./middleware/interceptor";
import Send from "./middleware/send";

import { FrameEncoder } from "@viae/pb";
import { Log } from "./log";
import { pino } from 'pino';
import { toUint8Array, shortId, Codex } from "./util";
import { UpgradeOutgoingReadableStream, UpgradeIncomingReadableStream } from "./middleware/readable-stream";
import { IVia, SendOptions, CallOptions, RequestOptions, InferRequestResponseData } from "./_via";
import { normalisePath } from "./util/normalise";




export interface RequestResponse<T = any> extends Response<T>, Disposable {
  ok: boolean;
}

/**
 * Via
 * Wraps a wire connection and processes inbound and outbound messages
 */
export class Via<C extends Context = Context> extends Rowan<C> implements IVia<C> {
  private _ev = new EventEmitter();
  private _active: Context[] = [];
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

  get active() {
    return this._active;
  }

  static Log: Log = pino();

  constructor(opts: { wire: Wire, Ctx?: ContextConstructor, uuid?: () => string, log?: Log, timeout?: number, codex?: Codex },) {
    super();
    const wire = this._wire = opts.wire;
    const codex = (opts ? opts.codex : undefined) || Codex.createDefault();
    this.CtxCtor = (opts ? opts.Ctx : undefined) || DefaultContext;
    this._log = (opts ? opts.log : undefined) || Via.Log;
    this._uuid = (opts ? opts.uuid : undefined) || shortId;
    this._timeout = (opts ? opts.timeout : undefined) || 10000;
    this.meta = {
      type: "Via"
    };

    this
      /* execute the 'before' pipeline */
      .use(this._before)
      /* execute the 'outbound' pipeline after the main pipeline */
      .use(new After([
        this.out
          .use(new AfterIf(function (ctx) { return Promise.resolve(!!ctx.out); }, [
            new UpgradeOutgoingReadableStream(),
            new DataEncoder(codex),
            new Send(this._encoder)
          ]))
      ]))
      .use(new Catch(
        function (err, ctx) {
          ctx.err = err;
          opts.log.error({err}, "error during processing");
          if (ctx.out) {
            ctx.out.head.status = Status.Error;
            ctx.out.data = err.message;
          }      
          return Promise.resolve();
        }))
      /* add the lazy data decoder */
      .use(new DataDecoder(codex))
      /* convert data into readable-stream  */
      .use(new UpgradeIncomingReadableStream())
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
      this._ev.emit("error", err);
    });
  }

  get log() {
    return this._log;
  }

  get ready() {
    return new Promise<void>((r, x) => {
      if (this._wire.readyState == WireState.OPEN) {
        return r();
      }
      const handlerOpen = () => {
        this._wire.off("open", handlerOpen);
        this._wire.off("error", handlerError);
        r();
      }
      const handlerError = (err) => {
        this._wire.off("open", handlerOpen);
        this._wire.off("error", handlerError);
        x(err);
      }

      this._wire.on("open", handlerOpen);
      this._wire.on("error", handlerError);
    })
  }

  private _onMessage(data: ArrayBuffer | ArrayBufferView) {
    const msg = this._encoder.decode(toUint8Array(data));
    const ctx = new this.CtxCtor({ connection: this as IVia<C>, in: msg, log: this._log });

    this._active.push(ctx);

    this.process(ctx as C)
      .then(() => {
        return ctx.complete;
      })
      .catch(err => {
        this._log.error({ err, ctx }, "unhandled error");
        this._ev.emit("error", err);
      }).finally(() => {
        let index = this._active.indexOf(ctx);
        this._active.splice(index, 1);
        return ctx[Symbol.asyncDispose]();
      })
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

    if (opts && typeof (opts.head) == "object") {
      Object.assign(msg.head, opts.head);
    }

    if (this._wire == undefined || this._wire.readyState !== WireState.OPEN) {
      throw Error("wire is not open");
    }

    let ctx = new this.CtxCtor({ connection: this as unknown as IVia<C>, out: msg as Message, log: this._log });
    return this.out.process(ctx)
      .then(() => ctx.complete)
      .catch((err) => {
        this._ev.emit("error", err);
        throw err;
      })
      .finally(() => {
        return ctx[Symbol.asyncDispose]()
      });
  }

  /**
   * Send a request message, add an one-off interceptor for the response. Returns promise to first response. 
   * @param msg 
   * @param opts 
   */
  async request<R, O extends RequestOptions>(
    method: string,
    path: string,
    data?: any,
    opts?: O & { validate?(value: any): value is R }): Promise<RequestResponse & (O['accept'] extends "stream" ? { data: ReadableStream<R> } : O['accept'] extends "object" ? { data: R } : {})> {

    path = normalisePath(path)

    let msg: Partial<Message> = {
      id: (opts && opts.id) ? opts.id : shortId(),
      head: { method, path }
    };

    if (data) {
      msg.data = data;
    }

    let reject, resolve, promise = new Promise<RequestResponse>((r, x) => { resolve = r; reject = x; });
    let clock;

    let dispose = this._interceptor.intercept({
      id: msg.id,
      handlers: [function (ctx, _) {
        const status = ctx.in.head.status;
        resolve(
          Object.assign(
            {
              ok: status >= 200 && status < 300,
              [Symbol.asyncDispose]() {
                return ctx.complete.then(_ => ctx[Symbol.asyncDispose]())
              }
            },
            ctx.in,
          ));

        return Promise.resolve();
      }]
    });

    clock = setTimeout(() => { reject("Request Timeout"); }, (opts ? opts.timeout : undefined) || this._timeout);

    try {
      await this.send(msg, opts);
      return await promise as any;
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
   * simplified request/response  - this will deserialize the response data and return it if successful. 
   * throws an error if the result status is not OK. 
   **/
  /*async call<E = any>(opts: CallOptions<E>): Promise<E> {
    const { method, path, data } = opts;
    let result = await this.request(method, path, data, opts);
    switch (Number(result.head.status)) {
      case Status.NotFound:
        throw Error(`${method} "${path}" not found`);
      case Status.Unauthorized:
        throw Error(`${method} "${path}" not authorized`);
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
  }*/

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
}

