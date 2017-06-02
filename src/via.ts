import { ViaContext, ViaRequestContext, ViaResponseContext } from './context';
import { Rowan, IRowan, Handler, IProcessor } from 'rowan';
import { Wire } from './wire';
import { ViaMessage } from './message';
import { ViaRequest } from './request';
import { ViaResponse } from './response';
import { ViaStatus } from './status';
import { ViaMethod } from './method';
import { ViaStream } from './stream';
import { shortId, bytesToHex, hexToBytes } from './utils';

import { Interceptor } from './middleware';

export * from './context';

export type ViaHandler = Handler<ViaContext>;
export type ViaProcessor = IProcessor<ViaContext>;
export class Via {
  private _app = new Rowan<ViaContext>();
  private _interceptor = new Interceptor();

  constructor(private _wire?: Wire) {
    this._app.use(this._interceptor);

    if (_wire) {
      _wire.on("message", x => this.processMessage(x, this._wire));
    }
  }

  protected processMessage(data: ArrayBuffer, wire: Wire) {
    const msg = ViaMessage.deserialiseBinary(new Uint8Array(data));
    this.process(this.createCtx(msg, wire));
  }

  protected createCtx(msg: ViaMessage, wire: Wire) {
    if (msg.status !== undefined)
      return this.createResponseCtx(msg, wire);
    return this.createRequestCtx(msg, wire);
  }

  protected createResponseCtx(msg: ViaMessage, wire: Wire) {
    const ctx: ViaResponseContext = {
      wire: wire,
      res: msg as ViaResponse,
    };
    return ctx;
  }

  protected createRequestCtx(msg: ViaMessage, wire: Wire) {
    const ctx: ViaRequestContext = {
      wire: wire,
      req: msg as ViaRequest,
      send: (body, status) => {
        this.send({
          id: msg.id,
          status: status | 404,
          body: body
        }, wire);
        ctx.send = () => { throw Error("Already sent a reply"); };
        ctx.$done = true;
      }
    };

    return ctx;
  }

  async process(ctx: ViaContext, err?: any) {
    try {
      await this._app.process(ctx, err);
    } catch (_err) {
      console.log(err);
    };
  }

  /** insert a handler (or chain) to run during processing*/
  use(handler: ViaHandler, ...handlers: ViaHandler[]): this {
    this._app.use(handler, ...handlers);
    return this;
  }

  send(msg: ViaMessage, wire = this._wire) {
    if (wire == undefined) {
      return Promise.reject("cannot send message to undefined wire");
    }

    const body = msg.body;
    if (body !== undefined && body["$stream"] !== undefined) {
      let streamable = body["$stream"];
      let sid = bytesToHex(shortId());
      body["$stream"] = sid;
    }

    const bin = ViaMessage.serialiseBinary(msg).buffer;
    wire.send(bin);
  }

  /**
   * Send a request. @returns promise to await the response. 
   **/
  request(
    method: ViaMethod,
    path: string,
    body?: string | Uint8Array | object | ViaStream | undefined,
    id?: string): Promise<ViaResponse> {
    id = id || bytesToHex(shortId());

    let reject;
    let resolve;
    let promise = new Promise<ViaResponse>((r, x) => { resolve = r, reject = x; });

    var dispose = this._interceptor.intercept(id, [
      (ctx: ViaResponseContext) => {
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
      });
    } catch (err) {
      dispose();
      reject(err);
      resolve = reject = null;
    }

    return promise;
  }
}
