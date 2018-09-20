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
    let i = 0;
    while (i < 1000) {
      let res = await via.request({
        head: {
          method: "GET",
          path: "/echo"
        },
        data: {
          [Symbol.asyncIterator]: async function* () {
            yield "hello";
            yield "world";
          }
        }
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