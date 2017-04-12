import * as Ws from 'ws';
import * as readline from 'readline';
import { Via, Router, } from './src/index';

let ws = new Ws("ws://127.0.0.1:9090");

ws.on("open", async () => {
  let via = new Via(ws);
  let router = new Router();
  
  via.use(router);

  router.route({
    method: "GET",
    path: "/service",
    handlers: [(ctx) => {
      console.log("GET service with " + ctx.req.body);
      ctx.send(ctx.req.body * 2);
    }]
  });

  let result = await via.request({
    method: "REGISTER",
    path: "/service"
  });

  console.log("Register: " + result.res.status);
});

