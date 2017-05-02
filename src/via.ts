import { ViaContext } from './context';

import { Rowan, IRowan, Handler, IProcessor } from 'rowan';
import { Wire } from './wire';
import { ViaMessage, ViaMessageStreamFlags } from './message';
import { ViaRequest } from './request';
import { ViaStatus } from './status';

import { Interceptor, Streamer, Unhandled } from './middleware';

import ctxFactory from './context-factory';

export { ViaContext } from './context';
export type ViaHandler = Handler<ViaContext>;
export type ViaProcessor = IProcessor<ViaContext>;

function defaultConfig() {
  let interceptor = new Interceptor();
  let streamer = new Streamer(interceptor);
  let unhandled = new Unhandled();

  return {
    interceptor: interceptor,
    streamer: streamer,
    unhandled: unhandled,
    rethrow: false,
    noop: function () { },
    genid: ViaMessage.genIdString
  };
}

export class Via implements IVia {
  private _root = new Rowan<ViaContext>();
  private _app = new Rowan<ViaContext>();
  private _before = new Rowan<ViaContext>();
  private _after = new Rowan<ViaContext>();

  private _createCtx: (wire: Wire, msg: ViaMessage) => ViaContext;

  constructor(private _wire?: Wire, private _config = defaultConfig()) {
    this._root.use(this._before);
    this._root.use(this._config.streamer);
    this._root.use(this._config.interceptor);
    this._root.use(this._app);
    this._root.use(this._config.unhandled);

    this._createCtx = ctxFactory(this.send, this._config.genid, this._config.noop);

    if (_wire) _wire.on("message", x => this.processMessage(x, this._wire));
  }

  protected processMessage(data: ArrayBuffer, wire: Wire) {
    const msg = ViaMessage.deserialiseBinary(new Uint8Array(data));
    const ctx = this._createCtx(wire, msg);
    return this.process(ctx);
  }

  /** @internal */
  async process(ctx: ViaContext, err?: any) {
    let result: any;

    try {
      result = await this._root.process(ctx, err);
    } catch (_err) {
      err = err;
    };

    if (result != undefined && typeof (result) != "boolean") {
      err = result;
    }

    delete ctx._done;

    try {
      await this._after.process(ctx, err);
    } catch (err) {
      if (this._config.rethrow) throw err;
    }
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

  /**
   * send a message
   */
  send(msg: ViaMessage)
  send(msg: ViaMessage, wires: Wire[])
  send(msg: ViaMessage, wires?: Wire[]) {
    if (wires === undefined) {
      if (this._wire !== undefined) {
        wires = [this._wire];
      } else {
        return;
      }
    }

    let bin = ViaMessage.serialiseBinary(msg).buffer;
    for (var wire of wires) {
      try {
        wire.send(bin);
      } catch (err) {
        console.log(err);
      }
    }
  }

  /**
   * send a request 
   **/
  request(msg: ViaMessage = {}, keepAlive = false, wire = this._wire, ...handlers: ViaHandler[]): Promise<ViaContext> {
    if (wire == undefined)
      return Promise.reject(undefined);

    if (msg.id == undefined)
      msg.id = ViaMessage.genIdString();

    let bin = ViaMessage.serialiseBinary(msg).buffer;

    let reject;
    let resolve;
    let resolved = false;
    let promise = new Promise<ViaMessage>((r, x) => { resolve = r, reject = x; });

    var dispose = this._config.interceptor.intercept(msg.id, [(ctx) => {
      if (!resolved)
        resolve(ctx);
      if (!keepAlive)
        dispose();
    }, ...handlers, (_) => false]);

    try {
      wire.send(bin);
    } catch (err) {
      dispose();
      reject(err);
    }
    return promise;
  }
}


export interface IVia extends IRowan<ViaContext> {

  /** insert middleware to run after any processing */
  before(handler: ViaHandler, ...handlers: ViaHandler[]): this;
  /** insert a handler (or chain) to run during processing*/
  use(handler: ViaHandler, ...handlers: ViaHandler[]): this;
  /** insert middleware to run before any processing */
  after(handler: ViaHandler, ...handlers: ViaHandler[]): this;

  /**
   * send a message
   */
  send(msg: ViaMessage);
  send(msg: ViaMessage, wires: Wire[]);

  /**
   * send a request 
   **/
  request(msg: ViaMessage): Promise<ViaContext>;
  request(msg: ViaMessage, keepAlive: boolean): Promise<ViaContext>;
  request(msg: ViaMessage, keepAlive: boolean, wire: Wire, ...handlers: ViaHandler[]): Promise<ViaContext>;
}

