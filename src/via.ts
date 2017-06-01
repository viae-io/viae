import { ViaContext } from './context';

import { Rowan, IRowan, Handler, IProcessor } from 'rowan';
import { Wire } from './wire';
import { ViaMessage, ViaStreamFlags } from './message';
import { ViaRequest } from './request';
import { ViaStatus } from './status';
import { ViaMethod } from './method';
import { ViaStream } from './stream';

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

    const ctx = {
      wire: wire,
      req: msg
    };

    return this.process(ctx);
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

    const bin = ViaMessage.serialiseBinary(msg).buffer;

    wire.send(bin);
  }

  /**
   * Send a request. @returns promise to await the reply. 
   **/
  request(
    method: ViaMethod,
    body: string | ArrayBuffer | object | ViaStream,
    id: string = ViaMessage.genIdString()): Promise<ViaContext> {

    let reject;
    let resolve;
    let promise = new Promise<ViaMessage>((r, x) => { resolve = r, reject = x; });

    var dispose = this._interceptor.intercept(id, [
      (ctx) => {
        if (resolve !== null) {
          resolve(ctx);
          resolve = reject = null;
        }
        dispose();
        return false;
      }]);

    try {
      this.send(msg);
    } catch (err) {
      dispose();
      reject(err);
      resolve = reject = null;
    }
    return promise;
  }
}
