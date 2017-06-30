import { Context, ContextHandler, RequestContext } from './context';
import { Viae } from './viae';
import { Via } from './via';
import { Method } from './method';
import { requestMethod, requestPath } from './middleware';
import { LiteEventEmitter } from 'lite-event-emitter';
import { Rowan } from 'rowan';

export type Subscriber = {
  connection: Via,
  id: string,
  [index: string]: any
};

export type SubscriptionContext = RequestContext & {
  sub: Subscriber
};

export class Subscription extends Rowan<RequestContext> {
  protected _path: string;
  protected _subs: Subscriber[] = [];
  protected _events = new LiteEventEmitter();

  public get subscribers() { return this._subs; }

  constructor(opts: {
    path: string,
    subscribe?: ContextHandler[],
    unsubscribe?: ContextHandler[]
  }) {
    super();
    this._path = opts.path;
    this.use(
      requestMethod(Method.SUBSCRIBE),
      requestPath(opts.path),
      (ctx: SubscriptionContext) => {
        ctx.sub = { connection: ctx.connection, id: ctx.req.id };
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

        ctx.connection.wire.on("close", () => {
          dispose();
        });

        this._subs.push(sub);
        ctx.send({ status: 200 });
        this._events.emit("subscribe", sub);
        return false;
      });

    this.use(
      requestMethod(Method.UNSUBSCRIBE),
      requestPath(opts.path),
      (ctx: SubscriptionContext) => {
        const sub = this._subs.find(x => x.wire == ctx.wire);
        if (sub == undefined) {
          return ctx.send({ status: 400 });
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

        ctx.send({ status: 200 });

        return false;
      });
  }
  on(event: "subscribe", cb: (sub: Subscriber) => void): Function
  on(event: "unsubscribe", cb: (sub: Subscriber) => void): Function
  on(event: string, cb: (sub: Subscriber) => void): () => void {
    return this._events.on(event, cb);
  }
  publish<T>(value: T) {
    for (var sub of this._subs) {
      sub.connection.send({
        id: sub.id,
        body: value,
        status: 100
      });
    }
  }
}