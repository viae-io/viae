import { Context, RequestContext, ResponseContext } from './context';
import { Rowan, IRowan, Handler, IProcessor } from 'rowan';
import { Wire } from './wire';
import { Message } from './message';
import { Request } from './request';
import { Response } from './response';
import { Status } from './status';
import { Method } from './method';
import { StreamIntercept, Stream } from './stream';
import { Router } from './router';
import { shortId, bytesToHex, hexToBytes } from './utils';

import { Interceptor, Unhandled, request, requestMethod } from './middleware';

export * from './context';

export type ViaHandler = Handler<Context>;
export type ViaProcessor = IProcessor<Context>;

export class Via {
  private _root = new Rowan<Context>();
  private _app = new Rowan<Context>();
  private _before = new Rowan<Context>();
  private _after = new Rowan<Context>();
  private _interceptor = new Interceptor();
  private _unhandled = new Unhandled();

  constructor(private _wire?: Wire) {
    this._root.use(this._before);
    this._root.use(this._interceptor);
    this._root.use(this._app);
    this._root.use(this._unhandled);

    if (_wire) {
      _wire.on("message", x => this.deserialiseMessage(x, this._wire));
    }
  }

  async process(ctx: Context, err?: any) {
    try {
      await this._root.process(ctx, err);
    } catch (_err) {
      console.log(_err);
    };
  }

  protected deserialiseMessage(data: ArrayBuffer, wire: Wire) {
    const msg = Message.deserialiseBinary(new Uint8Array(data));

    if (msg.body !== undefined && msg.body["$stream"] !== undefined) {
      const streamWire = wire;
      const sid = msg.body["$stream"] as string;
      const via = this;
      const stream = {
        [Symbol.asyncIterator]: async function* () {
          let response;
          response = await via.request(Method.SUBSCRIBE, undefined, undefined, sid, streamWire);
          if (response.status != 200) { throw Error(response.body); }
          do {
            response = await via.request(Method.NEXT, undefined, undefined, sid, streamWire);
            switch (response.status) {
              case Status.Next:
                yield response.body;
                break;
              case Status.Done:
                return;
              default:
              case Status.Error:
                throw Error(response.body || "Unknown Error");
            }
          } while (true);
        }
      };
      msg.body["$stream"] = stream;
    }

    this.process(this.createCtx(msg, wire));
  }

  protected createCtx(msg: Message, wire: Wire) {
    if (msg.status !== undefined)
      return this.createResponseCtx(msg, wire);
    return this.createRequestCtx(msg, wire);
  }

  protected createResponseCtx(msg: Message, wire: Wire) {
    const ctx: ResponseContext = {
      id: msg.id,
      wire: wire,
      res: msg as Response,
    };
    return ctx;
  }

  protected createRequestCtx(msg: Message, wire: Wire) {
    const ctx: RequestContext = {
      id: msg.id,
      wire: wire,
      req: msg as Request,
      send: (body, status) => {
        if (typeof (body) == "function") {
          body = body();
        }
        const reply = {
          id: msg.id,
          status: status,
          body: body
        };
        this.send(reply, wire);
        ctx.send = () => { throw Error("Already sent a reply"); };
        ctx.$done = true;
      }
    };

    return ctx;
  }



  /** insert middleware to run after any processing */
  before(handler: ViaHandler, ...handlers: ViaHandler[]): this {
    this._before.use(handler, ...handlers);
    return this;
  }
  /** insert a handler (or chain) to run during processing*/
  use(handler: ViaHandler, ...handlers: ViaHandler[]): this {
    this._app.use(handler, ...handlers);
    return this;
  }
  /** insert middleware to run before any processing */
  after(handler: ViaHandler, ...handlers: ViaHandler[]): this {
    this._after.use(handler, ...handlers);
    return this;
  }

  send(msg: Message, wire = this._wire) {
    if (wire == undefined) {
      return Promise.reject("cannot send message to undefined wire");
    }
    const body = msg.body;

    if (body !== undefined && body["$stream"] !== undefined) {
      let iterable = body["$stream"];
      let sid = bytesToHex(shortId());
      let stream = new StreamIntercept(iterable, () => dispose());
      let dispose = this._interceptor.intercept(sid, [stream]);

      body["$stream"] = sid;
    }

    //console.log("sending", msg);        
    const bin = Message.serialiseBinary(msg).buffer;
    wire.send(bin);
  }

  /**
   * Send a request. @returns promise to await the response. 
   **/
  request(
    method: Method,
    path?: string | undefined,
    body?: string | Uint8Array | object | Stream | undefined,
    id?: string | undefined,
    wire: Wire = this._wire): Promise<Response> {
    id = id || bytesToHex(shortId());

    let reject;
    let resolve;
    let promise = new Promise<Response>((r, x) => { resolve = r, reject = x; });

    var dispose = this._interceptor.intercept(id, [
      (ctx: ResponseContext) => {
        if (resolve !== null) {
          resolve(ctx.res);
          resolve = reject = null;
        }
        dispose();
        ctx.$done = true;
        return false;
      }]);

    try {
      this.send({
        id: id,
        method: method,
        body: body,
        path: path
      }, wire);
    } catch (err) {
      dispose();
      reject(err);
      resolve = reject = null;
    }

    return promise;
  }
}
