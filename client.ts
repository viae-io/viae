import "core-js/modules/es7.symbol.async-iterator";

import * as Ws from 'ws';
import * as readline from 'readline';
import { Via, ViaMethod, ViaStatus } from './src';


let ws = new Ws("ws://127.0.0.1:9090");
let via = new Via(ws);

async function* readStreamAsync(sid: string, via: Via) {
  let response;
  response = await via.request(ViaMethod.SUBSCRIBE, undefined, undefined, sid);
  if (response.status != 200) { throw Error(response.body); }
  do {
    response = await via.request(ViaMethod.NEXT, undefined, undefined, sid);
    switch (response.status) {
      case ViaStatus.Next:
        yield response.body;
        break;
      case ViaStatus.Done:
        return;
      default:
      case ViaStatus.Error:
        throw Error(response.body || "Unknown Error");
    }
  } while (true);
}

ws.on("open", async () => {
  let result = await via.request(ViaMethod.GET, "/");

  for await (let item of readStreamAsync(result.body["$stream"], via)) {
    console.log(item);
  }

  ws.close();
});