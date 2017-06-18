import { Context, ContextHandler } from './';
import { Message } from '../message';
import { Method } from '../method';
import { Status } from '../status';
import { Wire } from '../wire';
import { Via } from '../via';
import { Body } from '../body';


export class ContextFactory {
  constructor(private via: Via) {
  }

  create(message: Message, connection: Via): Context {
    this.replaceIterable(message);

    let ctx: Context;

    if (message.status) {
      ctx = {
        id: message.id,
        res: message,
        connection: connection
      };
    }
    else {
      ctx = {
        id: message.id,
        req: message,
        connection: connection,
        send: (body: Body | undefined, status: Status) => {
          this.via.send({ id: ctx.id, status: status, body: body });
          delete ctx.send;
          ctx.$done = true;
        }
      };
    }
    return ctx;
  }

  replaceIterable(message: Message) {    
    if (message.body === undefined || typeof message.body["$iterable"] !== "string") return;

    const sid = message.body["$iterable"] as string;
    const noop = function () { };
    let dispose = noop;
    let via = this.via;

    const generator = async function* () {
      let response;
      response = await via.request(Method.SUBSCRIBE, undefined, undefined, sid);

      if (response.status != 200) {
        throw Error(response.body);
      }

      dispose = () => { via.request(Method.UNSUBSCRIBE, undefined, undefined, sid); };

      do {
        response = await via.request(Method.NEXT, undefined, undefined, sid);
        switch (response.status) {
          case Status.Next:
            yield response.body;
            break;
          case Status.Done:
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
      const callDispose = function () {
        dispose();
      };

      return Object.assign(iterator, {
        dispose: function () {
          dispose();
        }
      });
    };

    message.body["$iterable"] = { [Symbol.asyncIterator]: disposable };
  }
}