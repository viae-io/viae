import 'web-streams-polyfill';

import { Via } from '../../src';
import * as WebSocket from 'ws';

import {from, toArray, concatAll, pipe} from 'web-streams-extensions';

let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire });

via.on("open", async () => {
  let src = from([from([1,2]), from([3,4]), from([5,6]), from([7,8])]);

  let result = await via.call<ReadableStream<ReadableStream<number>>>("GET", "/echo", src)

  console.log(await toArray(pipe(result, concatAll())));

  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});