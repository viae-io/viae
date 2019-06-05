import { Via } from '../src';
import * as WebSocket from 'ws';
import { isObservable, of } from 'rxjs';
import { join } from 'path';

let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire: wire as any });

via.on("open", async () => {

  let joinRes = await via.request("GET", "/chat");

  if (isObservable(joinRes.data)) {
    joinRes.data.forEach(x => console.log(x));
  }

  await via.request("POST", "/chat", "hello world...");

  await new Promise((r, _) => setTimeout(r, 100));

  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});