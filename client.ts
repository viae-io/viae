import Via from './src/via';
import * as WebSocket from 'ws';
import { Wire, Status } from './src';
import { isObservable, from } from 'rxjs';
import { last, take } from 'rxjs/operators';

let wire = new WebSocket("ws://localhost:8080");
let via = new Via(wire as any);

function isIterable(a: any): a is AsyncIterable<any> {
  return a != undefined && a[Symbol.asyncIterator] != undefined;
}

via.on("open", async () => {
  console.log("opened");
  try {
    let res = await via.request({
      head: {
        method: "GET",
        path: "/chat/echo",
      },
      data: from([1, 2, 3])
    });

    if (isObservable(res.data)) {
      await res.data.forEach(x => console.log(x));
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