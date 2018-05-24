import { Viae, Context } from './src';
import { Server as WebSocketServer } from 'ws';
import { Wire } from './src';

let server = new WebSocketServer({ port: 8080, host: "localhost" });
let viae = new Viae(server);

viae.on("connection", (via) => {
  console.log("client connected");
  via.on("close", () => {
    console.log("client disconnected");
  });
});


viae.use(async (ctx, next) => {
  console.log(ctx.in.id);
  ctx.out = {
    id: ctx.in.id,
    head: { status: 200 }
  };
});

server.on("error", (error) => {
  console.log("connection error");
});