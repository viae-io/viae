import { Rowan } from 'rowan';

import { Context, ContextFactory, ContextHandler, RequestContext, ResponseContext } from './context';
import { Wire } from './wire';
import { Message } from './message';
import { Request } from './request';
import { Response } from './response';
import { Status } from './status';
import { Method } from './method';
import { Body } from './body';
import { shortId, bytesToHex, hexToBytes } from './utils';

import { Interceptor, Router, IterableRouter } from './middleware';

import { upgradeOutgoingIterable, upgradeIncomingIterable } from './iterable-helpers';

export class Via {
  private _factory = new ContextFactory(this);
  private _interceptor = new Interceptor();
  private _app = new Rowan<Context>([this._interceptor]);

  constructor(public wire: Wire) {
    wire.on("message", (raw: ArrayBuffer) => {
      const message = Message.deserialiseBinary(new Uint8Array(raw));
      upgradeIncomingIterable(message, this);
      const ctx = this._factory.create(message, this);
      const _ = this._app.process(ctx)
        .catch((err) => {
          console.log("unhandled processing error", err);
          wire.close();
        });
    });
  }

  on(event: "close", cb: () => void) {
    this.wire.on(event, cb);
  }

  use(handler: ContextHandler) {
    this._app.use(handler);
  }

  /** 
   * send a message along the wire. 
   * automatically replaces iterables with a iterable-router instance 
   **/
  send(message: Message) {

    upgradeOutgoingIterable(message, this._interceptor);

    const bin = Message.serialiseBinary(message).buffer;
    this.wire.send(bin);
  }

  /**
   * Send a request. @returns promise to await the response. 
   **/
  request(
    opts: {
      method: Method,
      path?: string,
      body?: Body,
      id?: string
    }
  ): Promise<Response> {
    opts.id = opts.id || bytesToHex(shortId());

    let reject;
    let resolve;
    let promise = new Promise<Response>((r, x) => { resolve = r, reject = x; });

    var dispose = this._interceptor.intercept(opts.id, [
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
        id: opts.id,
        method: opts.method,
        body: opts.body,
        path: opts.path
      });
    } catch (err) {
      dispose();
      reject(err);
      resolve = reject = null;
    }

    return promise;
  }
}

