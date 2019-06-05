import { Observable, isObservable, Subscription, Observer, asyncScheduler } from 'rxjs';
import { observeOn } from 'rxjs/operators';
import { Context, RequestContext, ResponseContext } from '../context';
import { Rowan, If, Middleware } from "rowan";
import { request } from "./request";

export class ObservableSender extends Rowan<RequestContext> {
  constructor(observable: Observable<any>, dispose: () => void) {
    super();

    let sub: Subscription;
    let sid: string;

    this.use(new If(request("SUBSCRIBE"), [
      async (ctx, next) => {
        if (sub != null) { throw Error("Already observing"); }
        let sid = ctx.in.id;
        let wire = ctx.connection;

        //Remove default response. 
        delete ctx.out;

        sub = observable.pipe(observeOn(asyncScheduler)).subscribe(
          async (next) => {
            await wire.send({ id: sid, head: { status: 206 }, data: next });
          },
          async (err) => {
            await wire.send({ id: sid, head: { status: 500 }, data: err });
            dispose();
          },
          async () => {
            await wire.send({ id: sid, head: { status: 200 } });
            dispose();
          });

        observable = null;
      }
    ]));

    this.use(new If(request("UNSUBSCRIBE"), [
      async (ctx, next) => {
        if (sub) {
          sub.unsubscribe();
        }
        if (dispose) {
          dispose();
        }
        ctx.send({ head: { status: 200 } });
      }]));
  }
}

export class UpgradeOutgoingObservable implements Middleware<Context> {
  async process(ctx: Context, next: () => Promise<void>) {

    if (!ctx) return next();

    const head = ctx.out.head;
    const data = ctx.out.data;

    if (isObservable(data)) {

      let observable = data;
      let sid = ctx.connection.createId();
      let router = new ObservableSender(observable, function () { dispose(); });
      let dispose = ctx.connection.intercept(sid, [router]);

      head["observable"] = sid;

      delete ctx.out.data;
    }
    await next();
  }
}

export class UpgradeIncomingObservable implements Middleware<Context> {
  process(ctx: Context, next: () => Promise<void>) {
    if (!ctx.in || !ctx.in.head || typeof ctx.in.head["observable"] !== "string") {
      return next();
    }

    const sid = ctx.in.head["observable"] as string;
    const connection = ctx.connection;

    let observable: Observable<any> = Observable.create(async function (observer: Observer<any>) {
      try {

        let dispose = connection.intercept(sid, [
          async (ctx: ResponseContext) => {
            let res = ctx.in;
            let status = res.head.status;
            let data = res.data;

            if (status == 206) {
              observer.next(data);
            } else if (status == 500) {
              observer.error(data);
              dispose();
            } else {
              observer.complete();
              dispose();
              dispose = undefined;
            }
          }]);

        await connection.send({ id: sid, head: { method: "SUBSCRIBE" } });

        return function () {
          console.log("WHAT WHAT");
          if (dispose) {
            connection.send({ id: sid, head: { method: "UNSUBSCRIBE" } });
            dispose();
          }
        };
      } catch (err) {
        console.log(err);
      }
    });

    ctx.in.data = observable;

    return next();
  }
}