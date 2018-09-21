import Via from './src/via';
import * as WebSocket from 'ws';
import { Wire } from './src';

let wire = new WebSocket("ws://localhost:8080");
let via = new Via(wire as any);

function isIterable(a: any): a is AsyncIterable<any> {
  return a != undefined && a[Symbol.asyncIterator] != undefined;
}

via.on("open", async () => {
  console.log("opened");
  try {
    for (let i = 0; i < 100000; i++) {
      let res = await via.request({
        head: {
          method: "GET",
          path: "/echo/123",
        },
        data: "John"
      });
    }
  } catch (err) {
    console.log(err);
  }

  /* closing wire */
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});