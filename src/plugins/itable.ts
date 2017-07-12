import { Plugin } from '../plugin';
import { Viae } from '../viae';
import { Via } from '../via';
import { Method } from '../method';
import { Message } from '../message';
import { Status } from '../status';
import { Rowan } from 'rowan';
import { RequestContext } from '../context';
import { Wire } from '../wire';
import { bytesToHex, shortId } from '../utils';
import { request, requestPath, requestMethod, Interceptor } from '../middleware';

/** 
 * Allows sending and recieving (pull-based) Iterable sequences
 * 
 * usage: 
 * send: a body with [Symbol.asyncIterator] implemented 
 * recieve: for await(let item of body)
 * 
 * install: 
 *   client: via.use(new Itable());
 *   server: viae.use(new Itable());
 **/
export class Itable {

  constructor(){
    if(Symbol.asyncIterator === undefined){
      throw Error("Symbol.asyncIterator is not defined");
    }
  }

  plugin(target: Viae | Via) {
    let upgrade = (via: Via) => {
      via.on("send", (msg) => {
        if (msg.body != undefined && msg.body[Symbol.asyncIterator] != undefined) {
          upgradeOutgoingIterable(msg, via["_interceptor"]);
        }
      });

      via.on("message", (msg) => {
        if (msg.body != undefined && msg.body["$iterator"] !== undefined) {
          upgradeIncomingIterable(msg, via);
        }
      });
    };

    if (target instanceof Viae) {
      const viae = target;
      viae.on("connection", upgrade);
    } else {
      const via = target;
      upgrade(via);
    }
  }
}

function upgradeIncomingIterable(message: Message, via: Via) {

  if (message.body == undefined) return;
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
}

function upgradeOutgoingIterable(message: Message, interceptor: Interceptor) {
  const body = message.body;
  if (body != undefined && body[Symbol.asyncIterator] != undefined) {
    let iterable = body;
    let sid = bytesToHex(shortId());
    let router = new IterableRouter(iterable, function () { dispose(); });
    let dispose = interceptor.intercept(sid, [router]);

    body["$iterator"] = sid;
  }
}

class IterableRouter extends Rowan<RequestContext> {
  constructor(iterable: Iterable<any> | AsyncIterable<any>, dispose: () => void) {
    super();

    let iterator: Iterator<any>;

    this.use(
      requestMethod(Method.SUBSCRIBE),
      (ctx: RequestContext) => {
        try {
          if (iterator !== undefined)
          { throw Error("Already subscribed"); }
          if (iterable[Symbol.asyncIterator])
            iterator = iterable[Symbol.asyncIterator]();
          else
            iterator = iterable[Symbol.iterator]();

          ctx.send({ status: Status.OK });
        } catch (err) {
          ctx.send({ body: err.message, status: Status.Error });
        }
      });

    this.use(
      request(),
      requestMethod(Method.NEXT),
      async (ctx: RequestContext) => {
        let body: any;
        let status: Status;

        try {
          let result = await iterator.next();
          body = result.value;
          status = result.done ? Status.OK : Status.Next;
        } catch (err) {
          body = err.message;
          status = Status.Error;
        }

        ctx.send(body != undefined ? { body: body, status: status } : { status: status });
        if (status != Status.Next) {
          dispose();
        }
      });

    this.use(
      request(),
      requestMethod(Method.UNSUBSCRIBE),
      (ctx: RequestContext) => {
        ctx.send({ status: Status.OK });
        dispose();
      });
  }
}