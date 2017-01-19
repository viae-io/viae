import * as pathToRegexp from 'path-to-regexp';
import { Readable } from 'stream';
import { Rowan, IRowan, Handler } from 'rowan';

import { Events } from './utils/events';
import { Wire } from './wire';
import { Method } from './method';
import { Context } from './context';
import { Message, MessageFlags } from './message';
import { MessageSerialiser } from './message-serialiser';

import { ViaPath, ViaHandler, ViaInterceptor } from './via-types';
export { ViaPath, ViaHandler, ViaInterceptor } from './via-types';

import { unhandled, unhandledError, fatalError } from './middleware/unhandled';

export class Via implements IRowan<Context> {
  private _root = new Rowan<Context>();
  private _app = new Rowan<Context>();

  protected _serialiser = new MessageSerialiser();
  protected _interceptors = new Map<string, ViaInterceptor>();

  constructor(private wire?: Wire) {
    //TODO: Move these out;     
    this._root.use(this.interceptors());
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
    let dispose = () => this._interceptors.delete(id);

    this._interceptors.set(id, {
      dispose: dispose,
      handlers: [handler, ...handlers]
    });

    return dispose;
  }

  use(handler: ViaHandler, ...handlers: ViaHandler[]) {
    this._app.use(handler, ...handlers);
    return this;
  }

  get(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    this.method(Method.GET, path, handler, ...handlers);
    return this;
  }

  put(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    this.method(Method.PUT, path, handler, ...handlers);
    return this;
  }

  post(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    this.method(Method.POST, path, handler, ...handlers);
    return this;
  }

  patch(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    this.method(Method.PATCH, path, handler, ...handlers);
    return this;
  }

  delete(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    this.method(Method.DELETE, path, handler, ...handlers);
    return this;
  }

  subscribe(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    this.method(Method.SUBSCRIBE, path, handler, ...handlers);
    return this;
  }

  unsubscribe(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    this.method(Method.UNSUBSCRIBE, path, handler, ...handlers);
    return this;
  }

  method(method: Method, path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    this.use(
      (ctx) => ctx.req.method === method,
      this.pathHandler(path),
      handler,
      ...handlers);
    return this;
  }

  path(path: ViaPath, handler: ViaHandler, ...handlers: ViaHandler[]) {
    this.use(this.pathHandler(path), handler, ...handlers);
    return this;
  }

  private pathHandler(path: ViaPath) {
    let keys = [];
    var exp = pathToRegexp(path, keys);
    return async (ctx: Context) => {
      let match = (ctx.req.path) ? exp.exec(ctx.req.path) : null;
      if (match == null) {
        return false;
      }
      if (keys.length > 0) {
        ctx.req.params = ctx.req.params || {};
        for (let i = 0; i < keys.length; i += 1) {
          ctx.req.params[keys[i].name] = match[i + 1];
        }
      }
    };
  }

  protected send(msg: Message, wire?: Wire) {
    wire = wire || this.wire;

    if (wire == undefined)
      throw Error("wire is undefined");

    let bin = this._serialiser.encode(msg).buffer;

    wire.send(bin);
  }

  request(msg: Message, ...handlers: ViaHandler[]) {
    if (msg.id == undefined)
      msg.id = Message.genIdString();

    let bin = this._serialiser.encode(msg).buffer;

    var resolve;
    let promise = new Promise<Message>((r) => resolve = r);

    var dispose = this.intercept(msg.id, (ctx) => {
      resolve(ctx);
      dispose();
    }, ...handlers);

    this.wire.send(bin);
    return promise;
  }

  process(err: any, ctx: Context) {
    if (arguments.length == 2)
      return this._root.process(err, ctx);
    return this._root.process(ctx);
  }

  protected async decodeWireMessage(wire: Wire, binary: Uint8Array) {
    let msg = this._serialiser.decode(binary);

    let ctx = this.createContext(wire, msg);

    try {
      await this.process(undefined, ctx);
    }
    catch (err) {
      console.log("process exception:", err);
    }
  }

  private createContext(wire: Wire, msg: Message) {
    let ctx: Context = {
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

  private interceptors() {
    return async (ctx: Context) => {
      if ((ctx.res.id || ctx.req.id) == undefined)
        return;
      const interceptor = this._interceptors.get((ctx.res.id || ctx.req.id));
      if (interceptor != undefined) {
        return await Rowan.execute(undefined, ctx, interceptor.handlers);
      }
    };
  }

  private responseStreamer() {
    return async (ctx: Context) => {
      if (ctx.res != undefined &&
        ctx.res.flags !== undefined &&
        ctx.res.flags == MessageFlags.Begin &&
        ctx.res.body !== undefined &&
        typeof (ctx.res.body) == "string"
      ) {
        const sid = ctx.res.body;
        const stream = ctx.res.body = new Readable({ objectMode: true, read: function () { } });
        const dispose = this.intercept(sid, (ctx2: Context) => {
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