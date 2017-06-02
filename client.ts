import * as Ws from 'ws';
import * as readline from 'readline';
import { Via, ViaMethod } from './src';

let ws = new Ws("ws://127.0.0.1:9090");
let via = new Via(ws);

ws.on("open", async () => {

  console.log("open");

  let result = await via.request(
    ViaMethod.GET,
    "/"
  );

  console.log(result);
});