import { Via } from './src';
import * as WebSocket from 'ws';
import { isObservable, of } from 'rxjs';

let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire: wire as any });

via.on("open", async () => {
  console.log("opened");
  try {
    for (let i = 0; i < 10000000; i++) {
      await via.request("GET", "/api", "foobar");
    }
    
  } catch (err) {
    console.log(err);
  }
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});