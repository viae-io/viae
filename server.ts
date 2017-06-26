import "core-js/modules/es7.symbol.async-iterator";

import { Server as WebSocketServer } from 'ws';
import { Viae, RequestContext, Method, Router } from './src/index';
import { scribe, unhandled, iterable } from './src';

let wss = new WebSocketServer({ port: 9090 });
let server = new Viae(wss);
let router = new Router({ root: "/", name: "example", doc: "An example router" });

server.use(router);

router.route({
  method: Method.GET,
  path: "/echo",
  doc: "return the request body back to the client",
  handlers: [
    (ctx: RequestContext) => {
      ctx.send({ body: ctx.req.body });
    }]
});

server.use(unhandled());
server.use(scribe());
server.use(iterable());

console.log("Server Running on 9090....");

