import { Rowan, If } from "rowan";
import { RequestContext, Context } from "../context";
import { request } from "./router";
import { v4 as uuid } from 'uuid';

/** 
 * A single use router that can iterate an iterator
 **/
export class IterableRouter extends Rowan<RequestContext> {
  constructor(iterable: Iterable<any> | AsyncIterable<any>, dispose: () => void) {
    super();

    let iterator: Iterator<any>;

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

    this.use(new If(request("GET"), [
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
  }
}

export class UpgradeOutgoingIterable {
  process(ctx: Context, next: () => Promise<void>) {
    const head = ctx.out.head;
    const body = ctx.out.body;
    if (body != undefined && body[Symbol.asyncIterator] != undefined && (head.iterable || true)) {
      let iterable = body;
      let sid = uuid();
      let router = new IterableRouter(iterable, function () { dispose(); });
      let dispose = ctx.connection.intercept(sid, [router]);

      head["iterable"] = sid;
    }
  }
}

export class UpgradeIncomingIterable {
  process(ctx: Context, next: () => Promise<void>) {

    


    /* if (message.body == undefined) return;
  if (typeof message.body["$iterator"] !== "string") return;

  const sid = message.body["$iterator"] as string;
  const noop = function () { };
  let dispose = noop;

  const generator = async function* () {
    let response;
    response = await via.request({ method: Method.SUBSCRIBE, id: sid });

    if (response.status != 200) {
      throw Error(response.body);
    }

    dispose = () => { via.request({ method: Method.UNSUBSCRIBE, id: sid }); };

    do {
      response = await via.request({ method: Method.NEXT, id: sid });
      switch (response.status) {
        case Status.Next:
          yield response.body;
          break;
        case Status.OK:
          dispose = noop;
          return;
        default:
        case Status.Error:
          throw Error(response.body || "Unknown Error");
      }
    } while (true);
  };

  const disposable = function () {
    let iterator = generator();
    return Object.assign(iterator, {
      dispose: function () {
        dispose();
      }
    });
  };

  delete message.body["$iterator"];
  message.body[Symbol.asyncIterator] = disposable;
  */
   
  }
}