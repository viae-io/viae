
import { Readable } from 'stream';
import { Rowan, IRowan, Handler } from 'rowan';

import { EventEmitter } from './utils/events';
import { Wire } from './wire';
import { Method } from './method';
import { ViaContext } from './context';
import { Message, MessageFlags } from './message';

import { ViaPath, ViaHandler, ViaInterceptor } from './via-types';
export { ViaPath, ViaHandler, ViaInterceptor } from './via-types';

import { unhandled, unhandledError, fatalError } from './middleware/unhandled';
import { pathHandler } from './middleware/path-handler';
import { intercept } from './middleware/intercept';

export class Via implements IRowan<ViaContext> {
  private _root = new Rowan<ViaContext>();
  private _app = new Rowan<ViaContext>();

  /*@internal*/
  public interceptors = new Map<string, ViaInterceptor>();

  constructor(private wire?: Wire) {
    //TODO: Move these out;     
    this._root.use(intercept(this));
    this._root.use(this.responseStreamer());

    this._root.use(this._app);

    // Fallbacks 
    this._root.use(unhandled());
    this._root.use(unhandledError());
    this._root.use(fatalError());

    if (!!wire) {
      wire.on("message", (data) => this.decodeWireMessage(wire, new Uint8Array(data)));
    }
  }

  private intercept(id: string, handler: ViaHandler, ...handlers: ViaHandler[]): () => void {
    let dispose = () => this.interceptors.delete(id);

    this.interceptors.set(id, {
      dispose: dispose,
      handlers: [handler, ...handlers]
    });

    return dispose;
  }

  use(handler: ViaHandler, ...handlers: ViaHandler[]): this {
    this._app.use(handler, ...handlers);
    return this;
  }

  get(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.GET, path, handler, ...handlers);
  }

  put(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.PUT, path, handler, ...handlers);
  }

  post(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.POST, path, handler, ...handlers);
  }

  patch(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.PATCH, path, handler, ...handlers);
  }

  delete(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.DELETE, path, handler, ...handlers);
  }

  subscribe(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.SUBSCRIBE, path, handler, ...handlers);
  }

  unsubscribe(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.UNSUBSCRIBE, path, handler, ...handlers);
  }

  method(method: Method, path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.use((ctx) => ctx.req.method === method, pathHandler(path), handler, ...handlers);
  }

  path(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.use(pathHandler(path), handler, ...handlers);
  }

  /* solicited or unsolicited response */
  send(msg: Message, ...wires: Wire[]) {
    wires = wires || [this.wire];

    if (wires == undefined)
      throw Error("wire is undefined");

    let bin = Message.serialiseBinary(msg).buffer;

    for (var wire of wires) {
      wire.send(bin);
    }
  }

  request(msg: Message, ...handlers: ViaHandler[]) {
    if (msg.id == undefined)
      msg.id = Message.genIdString();

    let bin = Message.serialiseBinary(msg).buffer;

    var resolve;
    let promise = new Promise<Message>((r) => resolve = r);

    var dispose = this.intercept(msg.id, (ctx) => {
      resolve(ctx);
      dispose();
    }, ...handlers);

    this.wire.send(bin);
    return promise;
  }

  process(ctx: ViaContext)
  process(ctx: ViaContext, err?: any) {
    return this._root.process(ctx, err);
  }

  protected async decodeWireMessage(wire: Wire, binary: Uint8Array) {
    let msg = Message.deserialiseBinary(binary);

    let ctx = this.createContext(wire, msg);

    try {
      await this.process(ctx);
    }
    catch (err) {
      console.log("process exception:", err);
    }
  }

  /*internal*/
  createContext(wire: Wire, msg: Message) {
    let ctx: ViaContext = {
      wire: wire,
    };

    if (msg.status != undefined) {
      ctx.res = msg;
      return ctx;
    }

    ctx.req = msg;
    ctx.res = { id: msg.id };
    ctx.begin = () => {
      let sid = Message.genIdString();
      ctx.res.status = 200;
      ctx.res.flags = MessageFlags.Begin;
      ctx.res.body = sid;

      console.log(ctx.res);
      this.send(ctx.res, wire);

      ctx.res = {
        id: sid,
        status: 200,
        flags: MessageFlags.Next
      };

      ctx.send = (b) => {
        ctx.res.body = b;
        console.log(ctx.res);
        this.send(ctx.res, wire);
      };

      delete ctx.begin;
    };

    ctx.end = (body?) => {
      ctx.res.flags = MessageFlags.End;
      ctx.res.body = body;

      console.log(ctx.res);
      this.send(ctx.res, wire);
      delete ctx.send;
      delete ctx.end;
    };

    ctx.send = (body) => {
      ctx.res.body = body;
      ctx.res.status = 200;
      this.send(ctx.res, wire);
      delete ctx.send;
      return false;
    };

    return ctx;
  }
  

  private responseStreamer() {
    return async (ctx: ViaContext) => {
      if (ctx.res != undefined &&
        ctx.res.flags !== undefined &&
        ctx.res.flags == MessageFlags.Begin &&
        ctx.res.body !== undefined &&
        typeof (ctx.res.body) == "string"
      ) {
        const sid = ctx.res.body;
        const stream = ctx.res.body = new Readable({ objectMode: true, read: function () { } });
        const dispose = this.intercept(sid, (ctx2: ViaContext) => {
          if (ctx2.res === undefined) {
            dispose();
            stream.emit("error");
            stream.push(null);
          }
          if (ctx2.res != undefined && ctx2.res.body! + undefined) {
            stream.push(ctx2.res.body);
          }
          if (ctx2.res.flags == MessageFlags.End) {
            dispose();
            stream.push(null);
          }
          return false; // terminate 
        });
      }
    };
  }
}