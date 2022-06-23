import 'web-streams-polyfill';

import { Via } from '../../src';
import * as WebSocket from 'ws';

import { from, toArray, concatAll, pipe, toPromise, buffer, map } from 'web-streams-extensions';
import { skipPartiallyEmittedExpressions } from 'typescript';


let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire });
let N = 1024;
let i = 0;

async function sleep(ms) {
  await new Promise((r, x) => setTimeout(r, ms));
}

via.on("open", async () => {
  let src = from(async function* () {
    while (i++ < N) {
      yield Promise.resolve(new Uint8Array(1024));
      await new Promise((r, x) => setTimeout(r, 0));
    }
  })

  let result = await via.call<ReadableStream<number>>("GET", "/echo", src)

  await toPromise( pipe(result))       

  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});