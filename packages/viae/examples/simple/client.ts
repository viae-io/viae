import { Via } from '../../src';
import * as WebSocket from 'ws';

let wire = new WebSocket("ws://0.0.0.0:3000", { perMessageDeflate: false });
let via = new Via({ wire: wire as any });

via.on("open", async () => {  
  //console.log((await via.call("GET", "/")));
  console.log((await via.call("GET", "/info")));
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});