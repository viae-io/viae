import "core-js/modules/es7.symbol.async-iterator";

import * as Ws from 'ws';
import * as readline from 'readline';
import { Via, Method, Status } from './src';
import { Readable } from 'stream';


function streamFrom(iterable: AsyncIterable<any>) {
  const stream = new Readable({ objectMode: true });
  let iterator;

  stream["_read"] = function (size: number) {
    if (iterator === undefined)
      iterator = iterable[Symbol.asyncIterator]();

    iterator.next().then(res => {
      if (res.done)
        stream.push(null);
      else {
        stream.push(res.value);
      }
    }).catch((err) => {
      stream.emit("error", err);
    });
  };
  return stream;
}

let ws = new Ws("ws://127.0.0.1:9090");
let via = new Via(ws);

ws.on("open", async () => {
  let result = await via.request({
    method: Method.GET,
    path: "/echo",
    body: {
      $iterable: {
        [Symbol.asyncIterator]: function* () {
          yield "hello world";
          yield [1, 2, 3, 4];
          yield new Uint8Array([1, 2, 3, 4]);
          yield { name: "john", age: 50 };
          yield { data: new Uint8Array([1, 2, 3, 4]), meta: { unit: "mm" } };
        }
      }
    }
  });

  let stream = streamFrom(result.body["$iterable"]);

  stream.on("data", console.log);
  stream.on("end", () => { ws.close(); });
});
