import { Rowan } from 'rowan';
import { LiteEventEmitter } from 'lite-event-emitter';
import * as msgpack from 'msgpack-lite';

import { Context, ContextFactory, ContextHandler, RequestContext, ResponseContext } from './context';
import { Wire } from './wire';
import { Message } from './message';
import { Request } from './request';
import { Response } from './response';
import { Status } from './status';
import { Method } from './method';
import { Plugin, isPlugin } from './plugin';
import { shortId, bytesToHex, hexToBytes } from './utils';
import { Interceptor, Router } from './middleware';

export class Via {
  private _factory;
  private _interceptor;
  private _app: Rowan<Context>;
  private _ev = new LiteEventEmitter();

  constructor(
    public wire: Wire,

    opts = {
      interceptor: new Interceptor(),
      factory: new ContextFactory(),
      plugins: [] as Plugin[]
    }) {

    this._interceptor = opts.interceptor;
    this._factory = opts.factory;
    this._app = new Rowan<Context>([this._interceptor]);

    //for (let extension of opts.plugins) {
    //  extension.plugin(this);
    //}

    wire.on("message", (raw: ArrayBuffer) => {
      const message = msgpack.decode(new Uint8Array(raw));
      this._ev.emit("message", message);
      const ctx = this._factory.create(message, this);
      const _ = this._app.process(ctx)
        .catch((err) => {
          console.log("unhandled processing error", err);
          wire.close();
        });
    });
  }
  on(event: "message", cb: (msg: Message) => void)
  on(event: "send", cb: (msg: Message) => void)
  on(event: "close", cb: () => void)
  on(event: "error", cb: (err: Error) => void)
  on(event: any, cb: any) {
    if (event === "close") {
      this.wire.on(event, cb);
    }
    else {
      this._ev.on(event, cb);
    }
  }
  use(plugin: Plugin)
  use(handler: ContextHandler, ...handlers: ContextHandler[])
  use(handler: ContextHandler | Plugin, ...handlers: ContextHandler[]) {
    if (isPlugin(handler)) {
      handler.plugin(this);
    } else {
      this._app.use(handler, ...handlers);
    }
  }

  /** 
   * send a message along the wire.    
   **/
  send(message: Message) {
    this._ev.emit("send", message);
    const bin = msgpack.encode(message);
    this.wire.send(bin);
  }

  /**
   * Send a request. @returns promise to await the response. 
   **/
  request(
    message: Message & { method: Method },
    opts: { keepAlive?: boolean, handlers?: ContextHandler[] } = { keepAlive: false, handlers: [] }
  ): Promise<Response> {

    message.id = message.id || bytesToHex(shortId());

    const disposeOnIntercept = (!opts && !opts.keepAlive);

    return new Promise<Response>(
      (resolve, reject) => {
        const dispose = this._interceptor.intercept(message.id, [
          (ctx: ResponseContext) => {
            if (resolve !== null) {
              resolve(ctx.res);
              resolve = reject = null;
            }
            if (disposeOnIntercept) {
              dispose();
            }
          },
          ...opts.handlers]);

        try {
          this.send(message);
        } catch (err) {
          dispose();
          reject(err);
          resolve = reject = null;
        }
      });
  }
}