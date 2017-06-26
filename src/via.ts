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
  private _factory = new ContextFactory(this);
  private _interceptor = new Interceptor();
  private _app = new Rowan<Context>([this._interceptor]);
  private _ev = new LiteEventEmitter();

  constructor(public wire: Wire) {
    wire.on("message", (raw: ArrayBuffer) => {
      const message = msgpack.decode(raw);
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
  on(event: "send", cb: (msg: Message, opts: object) => void)
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
  send(message: Message, opts?: object) {
    this._ev.emit("send", message, opts);
    const bin = msgpack.encode(message);
    this.wire.send(bin);
  }

  /**
   * Send a request. @returns promise to await the response. 
   **/
  request(
    message: Message & { method: Method },
    opts?: object
  ): Promise<Response> {
    message.id = message.id || bytesToHex(shortId());

    return new Promise<Response>(
      (resolve, reject) => {
        const dispose = this._interceptor.intercept(message.id, [
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
          this.send(message, opts);
        } catch (err) {
          dispose();
          reject(err);
          resolve = reject = null;
        }
      });
  }
}

