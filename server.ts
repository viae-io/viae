import "core-js/modules/es7.symbol.async-iterator";

import { Server as WebSocketServer } from 'ws';
import { Viae, RequestContext, Method, Router, Subscription, Subscriber } from './src';
import { Scribe, Itable, unhandled } from './src';

let wss = new WebSocketServer({ port: 9090 });
let server = new Viae(wss);
let router = new Router({ root: "/", name: "example", doc: "An example router" });

server.use(new Scribe());
server.use(new Itable());

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

let sub = new Subscription({ path: "foo/bar/:id" });

server.use(sub);

server.use(unhandled());

console.log("Server Running on 9090....");

setInterval(() => {
  sub.publish("hello john", (x)=>x.params["id"] == "john");
}, 200);


