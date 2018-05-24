import { Viae, Context } from './src';
import { Server as WebSocketServer } from 'ws';
import { Wire } from './src';
import { Router } from './src/middleware';

let server = new WebSocketServer({ port: 8080, host: "localhost" });
let viae = new Viae(server);

viae.on("connection", (via) => {
  console.log("client connected");
  via.on("close", () => {
    console.log("client disconnected");
  });
});

let router = new Router({ root: "/" });

router.route({
  method: "GET",
  path: "/api",
  process: [async (ctx, next) => {
    ctx.out = {
      id: ctx.in.id,
      head: { status: 200 },
      body: "hello world"
    };
  }]
});

viae.use(router);

server.on("error", (error) => {  
  console.log("connection error");
});