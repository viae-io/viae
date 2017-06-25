import { ViaePlugin } from '../viae-plugin';
import { Viae } from '../viae';
import { Via } from '../via';
import { Method } from '../method';
import { Message } from '../message';
import { Status } from '../status';
import { Interceptor, IterableRouter } from '../middleware';
import { bytesToHex, shortId } from '../utils';

export function iterble() {
  return {
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
  };
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