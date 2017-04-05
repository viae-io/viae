
import { Readable } from 'stream';
import { Rowan, IRowan, Handler, IProcessor } from 'rowan';
import { Wire } from './wire';
import { Message, MessageStreamFlags } from './message';
import { Request } from './request';
import { Status } from './status';

export class Via implements IRowan<ViaContext> {
  private _interceptors = new Map<string, ViaInterceptor>();

  private _root = new Rowan<ViaContext>();
  private _app = new Rowan<ViaContext>();
  private _before = new Rowan<ViaContext>();
  private _after = new Rowan<ViaContext>();

  constructor(private wire?: Wire) {
    this._root.use(this._before);
    this._root.use(this.handlerIntercept());
    this._root.use(this.handlerResponseStream());
    this._root.use(this._app);
    this._root.use(this.handlerUnhandled());

    if (!!wire) {
      wire.on("message", x => this.processMessage(x, this.wire));
    }
  }

  protected async processMessage(data: ArrayBuffer, wire: Wire) {
    let msg = Message.deserialiseBinary(new Uint8Array(data));
    let ctx = this.createContext(wire, msg);
    await this.process(ctx);
  }

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

    this._after.process(ctx, err);
  }

  use(handler: ViaHandler, ...handlers: ViaHandler[]): this {
    this._app.use(handler, ...handlers);
    return this;
  }
  after(handler: ViaHandler, ...handlers: ViaHandler[]): this {
    this._after.use(handler, ...handlers);
    return this;
  }
  before(handler: ViaHandler, ...handlers: ViaHandler[]): this {
    this._before.use(handler, ...handlers);
    return this;
  }
  private intercept(id: string, handler: ViaHandler, ...handlers: ViaHandler[]): () => void {
    let dispose = () => this._interceptors.delete(id);

    this._interceptors.set(id, {
      dispose: dispose,
      timestamp: Date.now(),
      handlers: [handler, ...handlers]
    });

    return dispose;
  }

  /* send a solicited or unsolicited */
  send(msg: Message, ...wires: Wire[]) {
    wires = wires || [this.wire];

    if (wires == undefined)
      throw Error("wire is undefined");

    let bin = Message.serialiseBinary(msg).buffer;

    for (var wire of wires) {
      try {
        wire.send(bin);
      } catch (err) {
        console.log(err);
      }
    }
  }
  /* send a request message to the target wire */
  request(msg: Message = {}, keepAlive = false, wire = this.wire, ...handlers: ViaHandler[]) {
    if (wire == undefined)
      return Promise.resolve(undefined);

    if (msg.id == undefined)
      msg.id = Message.genIdString();

    let bin = Message.serialiseBinary(msg).buffer;

    let reject;
    let resolve;
    let resolved = false;
    let promise = new Promise<Message>((r, x) => { resolve = r, reject = x; });

    var dispose = this.intercept(msg.id, (ctx) => {
      if (!resolved)
        resolve(ctx);
      if (!keepAlive)
        dispose();
    }, ...handlers, (_) => false);

    try {
      this.wire.send(bin);
    } catch (err) {
      console.log(err);
      dispose();
      reject();
    }
    return promise;
  }

  private createContext(wire: Wire, msg: Message): ViaContext {
    const $noOp = function () { };
    let ctx: Partial<ViaContext> = {
      wire: wire
    };

    if (msg.status != undefined) {
      ctx.res = msg;
      return <ViaContext>ctx;
    }

    ctx.req = msg;
    ctx.res = { id: msg.id };

    ctx.end = $noOp;
    ctx.begin = () => {
      let sid = Message.genIdString();
      ctx.res.status = 200;
      ctx.res.flags = MessageStreamFlags.Begin;
      ctx.res.body = sid;

      this.send(ctx.res, wire);

      ctx.res = {
        id: sid,
        status: 200,
        flags: MessageStreamFlags.Next
      };

      ctx.send = (body) => {
        ctx.res.body = body || ctx.res.body;
        this.send(ctx.res, wire);
      };

      ctx.sendStatus = $noOp;

      ctx.end = (body?) => {
        ctx.res.flags = MessageStreamFlags.End;
        ctx.res.body = body || ctx.res.body;

        this.send(ctx.res, wire);
        ctx._done = true;
        
        ctx.send = $noOp;
        ctx.end = $noOp;        
      };
      ctx.begin = $noOp;
    };

    ctx.send = (body) => {
      ctx.res.body = body || ctx.res.body;
      ctx.res.status = ctx.res.status || 200;
      this.send(ctx.res, wire);
      ctx._done = true;
      ctx.send = $noOp;
      ctx.sendStatus = $noOp;
      return false;
    };

    ctx.sendStatus = (code: Status, body?: any) => {
      ctx.res.body = body || ctx.res.body;  
      ctx.res.status = code;
      this.send(ctx.res, wire);      
      ctx._done = true;
      ctx.send = $noOp;
      ctx.sendStatus = $noOp;
      return false;
    };

    return <ViaContext>ctx;
  }

  private handlerIntercept() {
    return async (ctx: ViaContext) => {
      if ((ctx.res.id || ctx.req.id) == undefined) return;
      const interceptor = this._interceptors.get((ctx.res.id || ctx.req.id));
      if (!!interceptor) { return await Rowan.execute(ctx, undefined, interceptor.handlers); }
    };
  };

  private handlerResponseStream() {
    return (ctx: ViaContext) => {
      if (ctx.res != undefined &&
        ctx.res.flags !== undefined &&
        ctx.res.flags == MessageStreamFlags.Begin &&
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
          if (ctx2.res.flags == MessageStreamFlags.End) {
            dispose();
            stream.push(null);
          }
          return false; // terminate 
        });
      }
    };
  }

  private handlerUnhandled() {
    return {
      process(ctx: ViaContext, err: any) {
        if (ctx.req != undefined) {
          if (ctx.res != undefined) {
            if (ctx.res.status == undefined) {
              if (err == undefined) {
                ctx.res.status = 404;
              }
              else if (typeof (err) == "number") {
                ctx.res.status = err;
              }
              else {
                ctx.res.status = 500;
              }
            }
            if (ctx.send != undefined) {
              return ctx.send();
            }
          }
        }

        return err;
      }
    };
  }
}

export interface ViaContext {
  wire: Wire;
  req: Request;
  res: Message;

  begin();
  send(body?: string | Uint8Array | Object);
  sendStatus(status: Status, body?: string | Uint8Array | Object);
  end(body?: string | Uint8Array | Object);

  _done?: true;
}

export type ViaHandler = Handler<ViaContext>;
export type ViaInterceptor = { dispose: () => void, timestamp: number, handlers: ViaHandler[] };
export type ViaProcessor = IProcessor<ViaContext>;