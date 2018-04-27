import { Viae } from './src';
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

viae.use(async (ctx) => {
  console.log("Got", ctx.req);
});

server.on("error", (error) => {
  console.log("connection error");
});