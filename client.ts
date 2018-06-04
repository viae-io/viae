import Via from './src/via';
import * as WebSocket from 'ws';
import { Wire } from './src';

let wire = new WebSocket("ws://localhost:8080");
let via = new Via(wire as any);

via.on("open", async () => {
  console.log("opened");


  try {
    for (let i = 0; i < 1000000; i++) {

      let response = await via.request({
        head: {
          method: "GET",
          path: "/api"
        },
      });

      await via.request({
        head: {
          method: "PUT",
          path: "/api",
        },
        body: response.body
      });
    }

  } catch (err) {
    console.log(err);
  }


  /* closing wire */
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});