import { Via } from '../../src';
import * as WebSocket from 'ws';
import { isObservable, of } from 'rxjs';
import { join } from 'path';

let wire = new WebSocket("ws://0.0.0.0:8080", { perMessageDeflate: false });
let via = new Via({ wire: wire as any });

via.on("open", async () => {  
  console.log((await via.request("POST", "/api/v1/echo")));
  console.log((await via.request("POST", "/api/v2/echo")));
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});