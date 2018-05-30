import Via from './src/via';
import * as WebSocket from 'ws';
import { Wire } from './src';

let wire = new WebSocket("ws://localhost:8080");
let via = new Via(wire as any);

via.on("open", async () => {
  console.log("opened");

  via.use((ctx, next) => {
    console.log(ctx.in.id);
    return next();
  });

  try {
    let response = await via.request({
      head: {
        method: "GET",
        path: "/api"
      },
    });
    console.log(response);

    response  = await via.request({
      head: {
        method: "PUT",
        path: "/api",
      },
      body: response.body
    });

    console.log(response);

  } catch (err) {
    console.log(err);
  }

  /* closing wire */
  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});