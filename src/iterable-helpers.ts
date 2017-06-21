import { Message } from './message';
import { IterableRouter, Interceptor } from './middleware';
import { bytesToHex, shortId } from './utils';
import { Via } from './via';
import { Method } from './method';
import { Status } from './status';

export function upgradeIncomingIterable(message: Message, via: Via) {
  if (message.body === undefined || typeof message.body["$iterable"] !== "string") return;

  const sid = message.body["$iterable"] as string;
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
    return Object.assign(iterator, {
      dispose: function () {
        dispose();
      }
    });
  };

  message.body["$iterable"] = { [Symbol.asyncIterator]: disposable };
}

export function upgradeOutgoingIterable(message: Message, interceptor: Interceptor) {
  const body = message.body;
  if (body !== undefined && body["$iterable"] !== undefined) {
    let iterable = body["$iterable"];
    let sid = bytesToHex(shortId());
    let router = new IterableRouter(iterable, function () { dispose(); });
    let dispose = interceptor.intercept(sid, [router]);
    body["$iterable"] = sid;
  }
}