import "core-js/modules/es7.symbol.async-iterator";

import * as Ws from 'ws';
import * as readline from 'readline';
import { Via, Method, Status } from './src';


let ws = new Ws("ws://127.0.0.1:9090");
let via = new Via(ws);

ws.on("open", async () => {
  let result = await via.request(
    Method.GET,
    "/echo",
    {
      $iterable: {
        [Symbol.iterator]: function* () {
          yield "hello world";
          yield [1, 2, 3, 4];
          yield new Uint8Array([1, 2, 3, 4]);
          yield { name: "john", age: 50 };
        }
      }
    });


  for await (let item of result.body["$iterable"]) {
    console.log(item);
  }

  ws.close();
});

