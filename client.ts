import { Via } from './src';
import * as WebSocket from 'ws';
import { isObservable, from } from 'rxjs';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let wire = new WebSocket("ws://localhost:8080");
let via = new Via({ wire: wire as any });

function isIterable(a: any): a is AsyncIterable<any> {
  return a != undefined && a[Symbol.asyncIterator] != undefined;
}

rl.on('line', (input) => {
  via.request({
    head: {
      method: "PUT",
      path: "/chat/message",
    },
    data: input
  });
});

via.on("open", async () => {
  console.log("opened");
  try {
    let res = await via.request({
      head: {
        method: "GET",
        path: "/chat/channel",
      },
      data: from([1, 2, 3, 4])
    });

    let task;

    if (isObservable(res.data)) {
      task = res.data.forEach(x => console.log(x));
    }
  } catch (err) {
    console.log(err);
  }
});

via.on("error", (err) => {
  console.log(err);
});