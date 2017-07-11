import "core-js/modules/es7.symbol.async-iterator";

import * as Ws from 'ws';
import * as readline from 'readline';
import { Via, Method, Status, Itable } from './src';

let ws = new Ws("ws://127.0.0.1:9090");
let via = new Via(ws);

via.use(new Itable());

ws.on("open", async () => {

  let result = await via.request({
    method: Method.GET,
    path: "/echo",
    body: {
      foo: "bar",
      [Symbol.asyncIterator]: function* () {
        yield "hello world";
        yield [1, 2, 3, 4];
        yield { name: "john", age: 50 };
        yield { data: new Uint8Array([1, 2, 3, 4]), meta: { unit: "mm" } };
      }
    }
  });

  for await (let item of result.body) {
    console.log(item);
  }

  via.request({
    method: Method.SUBSCRIBE,
    path: "foo/bar/james",
  }, {
      keepAlive: true,
      handlers: [(ctx) => {
        console.log(ctx.res.body);
      }]
    });
  await new Promise(r => setTimeout(r, 5000));

  ws.close();
});
