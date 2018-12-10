import { Via } from './src';
import * as WebSocket from 'ws';
import { isObservable, of } from 'rxjs';

let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire: wire as any });

via.on("open", async () => {
  console.log("opened");
  try {
    let res = await via.request("GET", "/api/dummy", of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));

    if (isObservable(res.data)) {
      await res.data.forEach(x => console.log(x));
    }
  } catch (err) {
    console.log(err);
  }
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});