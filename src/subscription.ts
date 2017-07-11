import { LiteEventEmitter } from 'lite-event-emitter';
import { Rowan } from 'rowan';

import { Context, ContextHandler, RequestContext } from './context';
import { Viae } from './viae';
import { Via } from './via';
import { Method } from './method';
import { Request } from './request';
import { Status } from './status';

import { request, requestMethod, requestPath } from './middleware';

export type Subscriber = {
  id: string;
  connection: Via;
  params?: any;
  req: Request;
  [index: string]: any;
}

export type SubscriptionContext = RequestContext;

/** 
 * A push-based pub/sub route processor 
 **/
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
      request(),
      requestMethod(Method.SUBSCRIBE),
      requestPath(opts.path),
      ...(opts.subscribe || []),
      (ctx: SubscriptionContext) => {
        let dispose = () => {
          let index = this._subs.findIndex(x => x.connection == ctx.connection);
          if (index > -1) {
            this._subs.splice(index, 1);
          }
        };

        ctx.connection.wire.on("close", () => {
          dispose();
        });

        this._subs.push(ctx);
        ctx.send({ status: 200 });
        this._events.emit("subscribe", ctx);
        return false;
      });

    this.use(
      request(),
      requestMethod(Method.UNSUBSCRIBE),
      requestPath(opts.path),
      (ctx: SubscriptionContext) => {
        const sub = this._subs.find(
          x =>
            x.connection == ctx.connection &&
            x.path == ctx.path);

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
  publish<T>(value: T, filter = function (sub: Subscriber) { return true; }) {
    for (var sub of this._subs.filter(filter)) {
      sub.connection.send({
        id: sub.id,
        body: value,
        status: Status.Next
      });
    }
  }
}