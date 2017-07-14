import "core-js/modules/es7.symbol.async-iterator";

import * as Ws from 'ws';
import * as readline from 'readline';
import { Via, Method, Status, Itable } from './src';

let ws = new Ws("ws://127.0.0.1:9090");

ws.on("open", async () => {
  let via = new Via(ws);

  via.use(new Itable());

  via.on("send", (msg) => {
    console.log("out: ", msg);
  });

  via.on("message", (msg) => {
    console.log(" in: ", msg);
  });

  await via.request({
    method: Method.POST,
    path: "/base/auth",
    body: "john"
  });

  let start = process.hrtime();
  let result = await via.request({
    method: Method.GET,
    path: "/base/echo",
    body: {
      async *[Symbol.asyncIterator]() {
        yield "hello..."
        yield "world";
      }
    }
  });

  if (isAsyncIterator(result.body)) {
    for await (let item of result.body) {
      //console.log(item)  
    }
  }
  let hrend = process.hrtime(start);

  console.info("Execution time: %ds", hrend[0] + hrend[1] / 1000000000);

  ws.close();
});


function isAsyncIterator(obj): obj is AsyncIterableIterator<any> {
  return typeof obj[Symbol.asyncIterator] !== "undefined"
}