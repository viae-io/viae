import Via from './src/via';
import * as WebSocket from 'ws';
import { Wire } from './src';

let wire = new WebSocket("ws://localhost:8080");
let via = new Via(wire as any);

via.on("open", async () => {
  console.log("opened");

  await via.send({
    head: {
      path: "/",
      method: "GET",
      id: undefined
    }
  });
});


via.on("error", (err) => {
  console.log(err);
});