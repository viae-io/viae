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

export type SubscriptionContext = ViaContext & {
  sub: Subscriber
};

export class Subscription extends Rowan<ViaContext> {
  protected _path: string;
  protected _server: Viae;
  protected _subs: Subscriber[] = [];
  protected _events = new LiteEventEmitter();

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
      (ctx: SubscriptionContext) => {
        ctx.sub = { wire: ctx.wire, id: ctx.req.id };
      },
      ...(opts.subscribe || []),
      (ctx: SubscriptionContext) => {
        const sub = ctx.sub;

        let dispose = () => {
          let index = this._subs.findIndex(x => x.wire == ctx.wire);
          if (index > -1) {
            this._subs.splice(index, 1);
          }
        };

        ctx.wire.on("close", () => {
          dispose();
        });

        this._subs.push(sub);

        ctx.res.status = 200;
        ctx.send();

        this._events.emit("subscribe", sub);

        return false;
      });

    this.use(
      requestMethod("UNSUBSCRIBE"),
      requestPath(opts.path),
      (ctx: SubscriptionContext) => {
        const sub = this._subs.find(x => x.wire == ctx.wire);
        if (sub == undefined) {
          return ctx.sendStatus(400);
        }
        ctx.sub = sub;
      },
      ...(opts.unsubscribe || []),
      (ctx: SubscriptionContext) => {
        const sub = ctx.sub;

        let index = this._subs.findIndex(x => x == sub);
        if (index > -1) {
          let sub = this._subs[index];
          this._subs.splice(index, 1);
        }

        ctx.sendStatus(200);

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
