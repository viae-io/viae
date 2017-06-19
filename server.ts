import "core-js/modules/es7.symbol.async-iterator";

import { Server as WebSocketServer } from 'ws';
import { Viae, RequestContext, Method, Unhandled } from './src/index';

let wss = new WebSocketServer({ port: 9090 });
let server = new Viae(wss);

server.route({
  method: Method.GET,
  path: "/echo",
  handlers: [(ctx: RequestContext) => {
    ctx.send(ctx.req.body, 200);
  }]
});

server.use(new Unhandled());

server.before((ctx) => {
  
});

server.after((ctx) => {
});


console.log("Server Running on 9090....");

