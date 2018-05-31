import { Rowan, If, Middleware } from "rowan";
import { RequestContext, Context } from "../context";
import { request } from "./request";
import { v4 as uuid } from 'uuid';
import { Message } from "..";

/** 
 * Pull-Based Router for an async iterable, intended to be used by an interceptor
 **/
export class IteratorRouter extends Rowan<RequestContext> {
  constructor(iterable: Iterable<any> | AsyncIterable<any>, dispose: () => void) {
    super();

    let iterator: Iterator<any>;

    this.use(new If(request("NEXT"), [
      async (ctx, next) => {
        let body: any;
        let status: number;
        try {
          let result = await iterator.next();
          body = result.value;
          status = result.done ? 200 : 206;
        } catch (err) {
          body = err.message;
          status = 500;
        }

        ctx.send(body != undefined ? { head: { status: status }, body: body } : { head: { status: status } });
        if (status != 206) {
          dispose();
        }
      }
    ]));

    this.use(new If(request("SUBSCRIBE"), [
      async (ctx, next) => {
        try {
          if (iterator !== undefined) { throw Error("Already subscribed"); }
          if (iterable[Symbol.asyncIterator])
            iterator = iterable[Symbol.asyncIterator]();
          else
            iterator = iterable[Symbol.iterator]();
          ctx.send({ head: { status: 200 } });
        } catch (err) {
          ctx.send({ head: { status: 500 }, body: err.message, });
        }
      }]));

    this.use(new If(request("UNSUBSCRIBE"), [
      async (ctx, next) => {
        await iterator.return();
        ctx.send({ head: { status: 200 } });
      }]));    
  }
}

export class UpgradeOutgoingIterable implements Middleware<Context> {
  process(ctx: Context, next: () => Promise<void>) {
    const head = ctx.out.head;
    const body = ctx.out.body;
    if (body != undefined && body[Symbol.asyncIterator] != undefined && ((head ? head.iterable : true) || true)) {
      let iterable = body;
      let sid = uuid();
      let router = new IteratorRouter(iterable, function () { dispose(); });
      let dispose = ctx.connection.intercept(sid, [router]);

      head["iterable"] = sid;
    }
    return next();
  }
}

export class UpgradeIncomingIterable implements Middleware<Context> {
  process(ctx: Context, next: () => Promise<void>) {
    if (!ctx.in || !ctx.in.body || typeof ctx.in.head["iterable"] !== "string") {
      return next();
    }

    const sid = ctx.in.head["iterable"] as string;
    const connection = ctx.connection;
    
    ctx.in.body[Symbol.asyncIterator] = function (): AsyncIterator<any> {
      let response: Message;
      let subscribed = false;     

      return {
        next: async function (): Promise<IteratorResult<any>> {          
          if (!subscribed) {
            subscribed = true;
            response = await connection.request({ id: sid, head: { method: "SUBSCRIBE" } });
            if (response.head.status != 200) {
              throw Error(response.body);
            }
          }

          response = await connection.request({ id: sid, head: { method: "NEXT" } });

          switch (response.head.status) {
            case 206:
              return { value: response.body, done: false };
            case 200:
              return { value: undefined, done: true };
            default:
            case 500:
              throw Error(response.body || "Unknown Error");
          }
        },
        return: async function () {  
          response = await connection.request({ id: sid, head: { method: "UNSUBSCRIBE" } });
          return { value: undefined, done: true };
        }
      };
    };

    return next();
  }
}