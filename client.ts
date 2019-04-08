import { Via } from './src';
import * as WebSocket from 'ws';
import { isObservable, of } from 'rxjs';

let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire: wire as any });

via.on("open", async () => {
  console.log("opened");
  try {
    for (let i = 0; i < 1000000; i++) {
      let res = await via.request("GET", "/api/1/");
    }
  } catch (err) {
    console.log(err);
  }
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});