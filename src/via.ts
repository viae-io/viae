import { Context, ContextFactory, ContextHandler, RequestContext, ResponseContext } from './context';
import { Rowan, IRowan, Handler, IProcessor } from 'rowan';
import { Wire } from './wire';
import { Message } from './message';
import { Request } from './request';
import { Response } from './response';
import { Status } from './status';
import { Method } from './method';
import { Body } from './body';
import { shortId, bytesToHex, hexToBytes } from './utils';

import { Interceptor, Router, IterableRouter } from './middleware';

export class Via {
  private factory = new ContextFactory(this);
  private interceptor = new Interceptor();
  private app = new Rowan<Context>([this.interceptor]);

  constructor(public wire: Wire) {
    wire.on("message", (raw: ArrayBuffer) => {
      const message = Message.deserialiseBinary(new Uint8Array(raw));
      const ctx = this.factory.create(message, this);
      const _ = this.app.process(ctx);
    });
  }

  use(handler: ContextHandler) {
    this.app.use(handler);
  }

  /** 
   * send a message along the wire. 
   * automatically replaces iterables with a iterable-router instance 
   **/
  send(message: Message) {
    const body = message.body;
    if (body !== undefined && body["$iterable"] !== undefined) {
      let iterable = body["$iterable"];
      let sid = bytesToHex(shortId());
      let router = new IterableRouter(iterable, function () { dispose(); });
      let dispose = this.interceptor.intercept(sid, [router]);

      body["$iterable"] = sid;
    }
    const bin = Message.serialiseBinary(message).buffer;
    this.wire.send(bin);
  }

  /**
   * Send a request. @returns promise to await the response. 
   **/
  request(
    method: Method,
    path?: string | undefined,
    body?: Body | undefined,
    id: string = bytesToHex(shortId())): Promise<Response> {

    let reject;
    let resolve;
    let promise = new Promise<Response>((r, x) => { resolve = r, reject = x; });

    var dispose = this.interceptor.intercept(id, [
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
      });
    } catch (err) {
      dispose();
      reject(err);
      resolve = reject = null;
    }

    return promise;
  }
}

