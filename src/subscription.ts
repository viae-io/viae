import { Wire } from './wire';
import { ViaContext, ViaHandler } from './via';
import { Viae } from './viae';
import { requestMethod, requestPath } from './middleware';
import { LiteEventEmitter } from 'lite-event-emitter';
import { Rowan } from 'rowan';

export type Subscriber = {
  wire: Wire,
  id: string,
  [index: string]: any
};

export class Subscription extends Rowan<ViaContext> {
  private _path: string;
  private _server: Viae;
  private _subs: Subscriber[] = [];
  private _events = new LiteEventEmitter();

  public get subscribers() { return this._subs; }

  constructor(opts: {
    path: string,
    server: Viae,
    subscribe?: ViaHandler[],
    unsubscribe?: ViaHandler[]
  }) {
    super();
    this._path = opts.path;
    this._server = opts.server;
    this.use(
      requestMethod("SUBSCRIBE"),
      requestPath(opts.path),
      ...(opts.subscribe || []),
      (ctx: ViaContext) => {
        const wire = ctx.wire;
        let dispose = () => {
          let index = this._subs.findIndex(x => x.wire == wire);
          if (index > -1) {
            this._subs.splice(index, 1);
          }
        };
        ctx.wire.on("close", () => {
          dispose();
        });

        let sub = { wire: wire, id: ctx.req.id };

        this._subs.push(sub);

        ctx.res.status = 200;
        ctx.send();

        this._events.emit("subscribe", sub);

        return false;
      });

    this.use(
      requestMethod("UNSUBSCRIBE"),
      requestPath(opts.path),
      ...(opts.unsubscribe || []),
      (ctx: ViaContext) => {
        const wire = ctx.wire;
        let index = this._subs.findIndex(x => x.wire == wire);

        if (index > -1) {
          let sub = this._subs[index];
          this._subs.splice(index, 1);
          ctx.res.status = 200;
          ctx.send();
          if (sub != undefined)
            this._events.emit("unsubscribe", sub);
        }
        else {
          ctx.res.status = 400;
          ctx.send();
        }
        return false;
      });
  }
  on(event: "subscribe", cb: (sub: Wire) => void): Function
  on(event: "unsubscribe", cb: (sub: Wire) => void): Function
  on(event: string, cb: () => void): () => void {
    return this._events.on(event, cb);
  }
  publish<T>(value: T) {
    for (var sub of this._subs) {
      this._server.send({
        id: sub.id,
        body: value,
        status: 100
      }, sub.wire);
    }
  }
}
